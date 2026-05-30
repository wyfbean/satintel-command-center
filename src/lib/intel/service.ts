import { runMockBackendIngestion } from "@/lib/backend/mock-backend";
import { sourceCatalog } from "@/lib/intel/catalog";
import { generateBriefing, enrichItemSummary, isLlmConfigured } from "@/lib/intel/llm";
import { listFeeds } from "@/lib/intel/rss-store";
import { dedupeAndRank, extractTrendSignals } from "@/lib/intel/scoring";
import { RssAdapter } from "@/lib/intel/adapters/rss-adapter";
import type { DashboardData, IntelItem, IntelSource } from "@/types/intel";

const rssAdapter = new RssAdapter();

function uniqueTags(items: IntelItem[]) {
  return Array.from(new Set(items.flatMap((item) => item.tags))).slice(0, 12);
}

/** Collect records from all user-added RSS feeds stored in SQLite. */
async function collectUserFeeds() {
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
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<RssAdapter["collect"]>>> => r.status === "fulfilled")
    .flatMap((r) => r.value);
}

export async function getDashboardData(): Promise<DashboardData> {
  // Run the static catalog ingestion and user RSS feeds in parallel.
  const [ingestion, userRecords] = await Promise.all([
    runMockBackendIngestion(),
    collectUserFeeds(),
  ]);

  const collected = [...ingestion.records, ...userRecords];
  const ranked = dedupeAndRank(collected);
  const enriched = await Promise.all(ranked.slice(0, 8).map(enrichItemSummary));
  const items = enriched.concat(ranked.slice(8));

  const allSources = sourceCatalog.length + listFeeds().length;
  const liveSources = new Set(items.filter((item) => item.channel !== "mock").map((item) => item.sourceId)).size;

  return {
    generatedAt: new Date().toISOString(),
    dateTitle: new Date().toLocaleDateString("zh-CN"),
    hero: {
      eyebrow: "AI 摘要 + RSS 聚合 + Ask AI",
      title: "卫星情报资讯流",
      description: "聚合卫星遥感行业内容与 RSS 订阅源，AI 提炼中文摘要，可按来源筛选追问。",
    },
    items,
    trends: extractTrendSignals(items),
    briefing: await generateBriefing(items),
    sourceSummary: {
      totalSources: allSources,
      liveSources,
      totalItems: items.length,
      llmConfigured: isLlmConfigured(),
    },
    scorecard: [],
    filters: {
      sources: Array.from(new Set(items.map((item) => item.sourceName))),
      tags: uniqueTags(items),
    },
  };
}
