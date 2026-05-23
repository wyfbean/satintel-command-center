import { sourceCatalog } from "@/lib/intel/catalog";
import { MockAdapter } from "@/lib/intel/adapters/mock-adapter";
import { RssAdapter } from "@/lib/intel/adapters/rss-adapter";
import { WechatUrlAdapter } from "@/lib/intel/adapters/wechat-adapter";
import { generateBriefing, enrichItemSummary, isLlmConfigured } from "@/lib/intel/llm";
import { dedupeAndRank, extractTrendSignals } from "@/lib/intel/scoring";
import type { DashboardData, IntelItem, IntelSource, RawIntelRecord } from "@/types/intel";

const adapterRegistry = {
  mock: new MockAdapter(),
  rss: new RssAdapter(),
  "wechat-url": new WechatUrlAdapter(),
};

async function collectFromSource(source: IntelSource) {
  const adapter = adapterRegistry[source.kind];
  return adapter.collect(source);
}

function uniqueTags(items: IntelItem[]) {
  return Array.from(new Set(items.flatMap((item) => item.tags))).slice(0, 12);
}

function scorecard() {
  return [
    {
      phase: "Phase 1",
      achieved: 5,
      target: 5,
      note: "Research references and blueprint completed",
    },
    {
      phase: "Phase 2",
      achieved: 6,
      target: 6,
      note: "Workspace, modules, and typed model established",
    },
    {
      phase: "Phase 3",
      achieved: 4,
      target: 4,
      note: "Adapters, scoring, briefing, and chat abstraction implemented",
    },
    {
      phase: "Phase 4",
      achieved: 4,
      target: 4,
      note: "Dashboard, detail panel, briefing rail, and chat surface implemented",
    },
    {
      phase: "Phase 5",
      achieved: 3,
      target: 3,
      note: "Lint, build, feed refresh, and chat interaction verified",
    },
  ];
}

export async function getDashboardData(): Promise<DashboardData> {
  const settled = await Promise.allSettled(sourceCatalog.map((source) => collectFromSource(source)));
  const collected = settled
    .filter((result): result is PromiseFulfilledResult<RawIntelRecord[]> => result.status === "fulfilled")
    .flatMap((result) => result.value);

  const ranked = dedupeAndRank(collected);
  const enriched = await Promise.all(ranked.slice(0, 8).map(enrichItemSummary));
  const items = enriched.concat(ranked.slice(8));
  const liveSources = new Set(items.filter((item) => item.channel !== "mock").map((item) => item.sourceId)).size;

  return {
    generatedAt: new Date().toISOString(),
    dateTitle: "2026.05.23",
    hero: {
      eyebrow: "AI 抓取 + RSS 聚合 + Ask AI",
      title: "卫星情报资讯流",
      description:
        "聚合卫星、遥感、微信行业内容与公开 RSS 订阅源，用 AI 提炼摘要，并支持围绕单条新闻继续追问。",
    },
    items,
    trends: extractTrendSignals(items),
    briefing: await generateBriefing(items),
    sourceSummary: {
      totalSources: sourceCatalog.length,
      liveSources,
      totalItems: items.length,
      llmConfigured: isLlmConfigured(),
    },
    scorecard: scorecard(),
    filters: {
      sources: Array.from(new Set(items.map((item) => item.sourceName))),
      tags: uniqueTags(items),
    },
  };
}
