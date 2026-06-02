/**
 * Single ingestion cycle: collect → translate titles → score → LLM-enrich → upsert.
 *
 * Called by the scheduler on a timer and also by POST /api/crawl/trigger.
 * All results are written to the articles SQLite table so subsequent
 * getDashboardData() calls read from the DB instead of re-fetching the network.
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
  listUntranslatedArticles,
  updateTitleZh,
} from "@/lib/intel/article-store";
import { translateTitle, enrichItemSummary, isLlmConfigured } from "@/lib/intel/llm";
import { dedupeAndRank } from "@/lib/intel/scoring";
import type { IntelSource, RawIntelRecord } from "@/types/intel";

const rssAdapter = new RssAdapter();

/** Translation/enrichment concurrency — keeps bursts off the LLM endpoint. */
const LLM_CONCURRENCY = 4;
/** Re-translate at most this many stale rows per cycle (LLM cost control). */
const BACKFILL_PER_CYCLE = 15;

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
 * Re-translate stored articles whose Chinese title never landed (title_zh empty
 * or still equal to the English original). Runs every cycle but is capped and
 * no-ops without an LLM so the deterministic fallback path stays intact.
 * Uses bypassCache so a previously poisoned cache entry can't block the fix.
 */
async function backfillTranslations(): Promise<number> {
  if (!isLlmConfigured()) return 0;
  const stale = listUntranslatedArticles(BACKFILL_PER_CYCLE);
  if (!stale.length) return 0;
  let fixed = 0;
  await mapPool(stale, LLM_CONCURRENCY, async (a) => {
    const zh = await translateTitle(a.title, a.body, { bypassCache: true });
    if (zh && zh !== a.title) {
      updateTitleZh(a.id, zh);
      fixed++;
    }
  });
  return fixed;
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

    // 3. Translate titles + LLM-enrich top items (capped to 12 to limit spend).
    //    A bounded concurrency window avoids bursting the LLM endpoint (which
    //    previously caused many translations to fail and fall back to English).
    const enriched = await mapPool(ranked, LLM_CONCURRENCY, async (item, i) => {
      const titleZh = await translateTitle(item.title, item.body);
      // Only call enrichItemSummary for top 12 (LLM cost control)
      const enrichedItem = i < 12 ? await enrichItemSummary(item) : item;
      return { item: enrichedItem, titleZh };
    });

    // 4. Upsert every item into the articles table
    let itemsNew = 0;
    for (const { item, titleZh } of enriched) {
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
        titleZh,
        summary: item.summary,
        whyItMatters: item.whyItMatters,
        compositeScore: item.compositeScore,
      });
      if (isNew) itemsNew++;
    }

    // 5. Backfill stale rows whose translation never landed, then collapse any
    //    duplicate URLs (e.g. left over from an older id scheme).
    const backfilled = await backfillTranslations();
    const dropped = dedupeByUrl();

    // 6. Retention cleanup — keep the long history as a retrieval corpus.
    pruneOldArticles();

    const result: IngestionResult = {
      itemsIn: ranked.length,
      itemsNew,
      durationMs: Date.now() - startedAt,
    };
    if (backfilled || dropped) {
      console.log(`[ingestion] backfilled ${backfilled} titles, deduped ${dropped} rows`);
    }
    logRunEnd(runId, result.itemsIn, result.itemsNew);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logRunEnd(runId, 0, 0, msg);
    return { itemsIn: 0, itemsNew: 0, durationMs: Date.now() - startedAt, error: msg };
  }
}
