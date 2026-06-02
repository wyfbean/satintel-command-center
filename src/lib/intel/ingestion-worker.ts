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
import { upsertArticle, logRunStart, logRunEnd, pruneOldArticles } from "@/lib/intel/article-store";
import { translateTitle, enrichItemSummary } from "@/lib/intel/llm";
import { dedupeAndRank } from "@/lib/intel/scoring";
import type { IntelSource, RawIntelRecord } from "@/types/intel";

const rssAdapter = new RssAdapter();

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

    // 3. Translate titles + LLM-enrich top items (capped to 12 to limit spend)
    //    Do these concurrently per item but with a small concurrency window
    //    to avoid overwhelming the LLM endpoint.
    const enriched = await Promise.all(
      ranked.map(async (item, i) => {
        const titleZh = await translateTitle(item.title, item.body);
        // Only call enrichItemSummary for top 12 (LLM cost control)
        const enrichedItem = i < 12 ? await enrichItemSummary(item) : item;
        return { item: enrichedItem, titleZh };
      }),
    );

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

    // 5. Periodic cleanup — keep last 14 days, skip mock seeds
    pruneOldArticles(14);

    const result: IngestionResult = {
      itemsIn: ranked.length,
      itemsNew,
      durationMs: Date.now() - startedAt,
    };
    logRunEnd(runId, result.itemsIn, result.itemsNew);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logRunEnd(runId, 0, 0, msg);
    return { itemsIn: 0, itemsNew: 0, durationMs: Date.now() - startedAt, error: msg };
  }
}
