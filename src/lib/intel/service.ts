import { runMockBackendIngestion } from "@/lib/backend/mock-backend";
import { sourceCatalog } from "@/lib/intel/catalog";
import { generateBriefing, enrichItemSummary, isLlmConfigured } from "@/lib/intel/llm";
import { listFeeds } from "@/lib/intel/rss-store";
import { listArticles, countRecentArticles } from "@/lib/intel/article-store";
import { dedupeAndRank, extractTrendSignals, toIntelItem } from "@/lib/intel/scoring";
import { RssAdapter } from "@/lib/intel/adapters/rss-adapter";
import type { DashboardData, IntelItem, IntelSource } from "@/types/intel";
import type { StoredArticle } from "@/lib/intel/article-store";

const rssAdapter = new RssAdapter();

function uniqueTags(items: IntelItem[]) {
  return Array.from(new Set(items.flatMap((item) => item.tags))).slice(0, 12);
}

/** Convert a DB-stored article into an IntelItem (all score fields already computed). */
function storedToIntelItem(a: StoredArticle): IntelItem {
  const channel = a.channel as IntelItem["channel"];
  return {
    id: a.id,
    sourceId: a.sourceId,
    sourceName: a.sourceName,
    channel,
    title: a.titleZh || a.title,   // prefer Chinese title
    excerpt: a.excerpt,
    body: a.body,
    url: a.url,
    publishedAt: a.publishedAt,
    tags: a.tags,
    region: a.region,
    imageryModes: a.imageryModes,
    // Enriched fields from ingestion
    summary: a.summary,
    whyItMatters: a.whyItMatters,
    compositeScore: a.compositeScore,
    // Derived inline (cheap)
    extractedEntities: [a.sourceName, ...a.tags].slice(0, 6),
    freshnessScore: 0,
    relevanceScore: 0,
    urgencyScore: 0,
    trendKey: a.tags[0] ?? "general",
    sourceLabel:
      channel === "rss" ? "RSS"
      : channel === "crawl" ? "网页抓取"
      : channel === "wechat-url" ? "微信抓取"
      : channel === "ai-generated" ? "AI 生成"
      : "AI 抓取",
    timelineLabel: a.tags[0] ?? a.sourceName,
  };
}

/** Hot path: load articles from the SQLite DB (last 48 h). */
async function getDashboardDataFromDb(): Promise<IntelItem[]> {
  const since48h = Date.now() - 48 * 3600 * 1000;
  const stored = listArticles({ limit: 80, sinceMs: since48h });
  if (!stored.length) return [];
  return stored.map(storedToIntelItem);
}

/** Cold-start fallback: live fetch from adapters (original pipeline). */
async function collectUserFeeds() {
  const feeds = listFeeds();
  if (!feeds.length) return [];
  const results = await Promise.allSettled(
    feeds.map((feed) => {
      const source: IntelSource = {
        id: feed.id, kind: "rss", name: feed.name, region: "用户订阅",
        reliabilityScore: 0.8, tags: feed.tags.length ? feed.tags : ["订阅"], url: feed.url,
      };
      return rssAdapter.collect(source);
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<RssAdapter["collect"]>>> => r.status === "fulfilled")
    .flatMap((r) => r.value);
}

async function getLiveDashboardItems(): Promise<IntelItem[]> {
  const [ingestion, userRecords] = await Promise.all([
    runMockBackendIngestion(),
    collectUserFeeds(),
  ]);
  const collected = [...ingestion.records, ...userRecords];
  const ranked = dedupeAndRank(collected);
  const enriched = await Promise.all(ranked.slice(0, 8).map(enrichItemSummary));
  return enriched.concat(ranked.slice(8));
}

export async function getDashboardData(): Promise<DashboardData> {
  // Decide whether to use the persisted DB or fall back to live fetch.
  const since48h = Date.now() - 48 * 3600 * 1000;
  const recentCount = countRecentArticles(since48h);

  let items: IntelItem[];
  if (recentCount >= 5) {
    // DB has enough data — serve from cache, no network calls
    items = await getDashboardDataFromDb();
  } else {
    // Cold start or stale — do a live fetch and let the scheduler catch up
    items = await getLiveDashboardItems();
  }

  // Mock seeds are always appended (they're already in the DB after first
  // ingestion, but we include them here as a safety net for a true cold start
  // before the first scheduler tick completes).
  if (items.every((i) => i.channel !== "mock")) {
    const mockIngestion = await runMockBackendIngestion(["mock"]);
    const mockItems = dedupeAndRank(mockIngestion.records).map(toIntelItem);
    const existingIds = new Set(items.map((i) => i.id));
    items = items.concat(mockItems.filter((i) => !existingIds.has(i.id)));
  }

  // Sort by composite score
  items = items.sort((a, b) => b.compositeScore - a.compositeScore);

  const allSources = sourceCatalog.length + listFeeds().length;
  const liveSources = new Set(
    items.filter((i) => i.channel !== "mock").map((i) => i.sourceId),
  ).size;

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
      regions: Array.from(new Set(items.map((item) => item.region).filter(Boolean))).sort(),
    },
  };
}
