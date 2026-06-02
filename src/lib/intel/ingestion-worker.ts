/**
 * Single ingestion cycle, two phases:
 *   A. collect → dedupe/score → upsert raw FAST (heuristic summary, no LLM)
 *   B. async enrichment: translate title + LLM summary for a capped batch of
 *      not-yet-enriched rows (highest composite_score first).
 *
 * Decoupling enrichment from storage keeps the cycle bounded regardless of how
 * many sources/items are fetched: raw data lands immediately, and Chinese
 * titles / AI summaries fill in across ticks. Called by the scheduler and by
 * POST /api/crawl/trigger. All results go to the articles SQLite table.
 */

import { runMockBackendIngestion } from "@/lib/backend/mock-backend";
import { listFeeds } from "@/lib/intel/rss-store";
import { RssAdapter } from "@/lib/intel/adapters/rss-adapter";
import {
  upsertArticle,
  logRunStart,
  logRunEnd,
  pruneOldArticles,
  dedupeByUrl,
  listUnenrichedArticles,
  markEnriched,
} from "@/lib/intel/article-store";
import { translateTitle, enrichItemSummary, isLlmConfigured } from "@/lib/intel/llm";
import { dedupeAndRank, toIntelItem } from "@/lib/intel/scoring";
import type { IntelSource, RawIntelRecord } from "@/types/intel";

const rssAdapter = new RssAdapter();

/** Translation/enrichment concurrency — keeps bursts off the LLM endpoint. */
const LLM_CONCURRENCY = 4;
/** Enrich at most this many not-yet-enriched rows per cycle (LLM cost control). */
const ENRICH_PER_CYCLE = 40;

/** Map with a bounded concurrency window (preserves input order). */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Phase B — async enrichment. Translates titles and generates AI summaries for
 * a capped batch of stored rows that haven't been enriched yet, newest/highest
 * score first. No-ops without an LLM so the deterministic fallback path (and the
 * heuristic summary already stored in Phase A) stays intact.
 */
async function enrichPending(): Promise<number> {
  if (!isLlmConfigured()) return 0;
  const pending = listUnenrichedArticles(ENRICH_PER_CYCLE);
  if (!pending.length) return 0;
  let done = 0;
  await mapPool(pending, LLM_CONCURRENCY, async (a) => {
    const titleZh = await translateTitle(a.title, a.body);
    const enriched = await enrichItemSummary(toIntelItem(a));
    markEnriched(a.id, {
      titleZh: titleZh && titleZh !== a.title ? titleZh : a.titleZh || a.title,
      summary: enriched.summary,
      whyItMatters: enriched.whyItMatters,
    });
    done++;
  });
  return done;
}

async function collectUserRssFeeds(): Promise<RawIntelRecord[]> {
  const feeds = listFeeds();
  if (!feeds.length) return [];
  const results = await Promise.allSettled(
    feeds.map((feed) => {
      const source: IntelSource = {
        id: feed.id,
        kind: "rss",
        name: feed.name,
        region: "用户订阅",
        reliabilityScore: 0.8,
        tags: feed.tags.length ? feed.tags : ["订阅"],
        url: feed.url,
      };
      return rssAdapter.collect(source);
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<RawIntelRecord[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);
}

export type IngestionResult = {
  itemsIn: number;
  itemsNew: number;
  durationMs: number;
  error?: string;
};

export async function runIngestionCycle(): Promise<IngestionResult> {
  const startedAt = Date.now();
  const runId = logRunStart();

  try {
    // 1. Collect from all sources in parallel
    const [ingestion, userRecords] = await Promise.all([
      runMockBackendIngestion(),
      collectUserRssFeeds(),
    ]);

    const raw = [...ingestion.records, ...userRecords];

    // 2. Dedupe + score (needed for composite_score in DB)
    const ranked = dedupeAndRank(raw);

    // 3. Phase A — upsert every item raw and FAST (heuristic summary, no LLM).
    //    Enrichment fields are preserved across unchanged re-crawls by upsertArticle.
    let itemsNew = 0;
    for (const item of ranked) {
      const isNew = upsertArticle({
        record: {
          id: item.id,
          sourceId: item.sourceId,
          sourceName: item.sourceName,
          channel: item.channel,
          title: item.title,
          excerpt: item.excerpt,
          body: item.body,
          url: item.url,
          publishedAt: item.publishedAt,
          tags: item.tags,
          region: item.region,
          imageryModes: item.imageryModes,
          image: item.image,
        },
        titleZh: "",
        summary: item.summary,
        whyItMatters: item.whyItMatters,
        compositeScore: item.compositeScore,
      });
      if (isNew) itemsNew++;
    }

    // 4. Phase B — async enrichment (translate + AI summary), capped & score-desc.
    const enriched = await enrichPending();

    // 5. Collapse any duplicate URLs (e.g. left over from an older id scheme).
    const dropped = dedupeByUrl();

    // 6. Retention cleanup — keep the long history as a retrieval corpus.
    pruneOldArticles();

    const result: IngestionResult = {
      itemsIn: ranked.length,
      itemsNew,
      durationMs: Date.now() - startedAt,
    };
    if (enriched || dropped) {
      console.log(`[ingestion] enriched ${enriched} rows, deduped ${dropped} rows`);
    }
    logRunEnd(runId, result.itemsIn, result.itemsNew);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logRunEnd(runId, 0, 0, msg);
    return { itemsIn: 0, itemsNew: 0, durationMs: Date.now() - startedAt, error: msg };
  }
}
