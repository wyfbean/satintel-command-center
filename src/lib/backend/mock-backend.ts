import { AiCrawlerAdapter } from "@/lib/intel/adapters/ai-crawler";
import { CrawlAdapter } from "@/lib/intel/adapters/crawl-adapter";
import { MockAdapter } from "@/lib/intel/adapters/mock-adapter";
import { RssAdapter } from "@/lib/intel/adapters/rss-adapter";
import { WechatUrlAdapter } from "@/lib/intel/adapters/wechat-adapter";
import type { SourceAdapter } from "@/lib/intel/adapters/base";
import { crawlUrls, rssSources, sourceCatalog } from "@/lib/intel/catalog";
import { getLlmSettings } from "@/lib/intel/llm";
import type { BackendOverview, IntelSource, RawIntelRecord, SourceKind, SourceRunReport } from "@/types/intel";

const adapterRegistry: Record<SourceKind, SourceAdapter> = {
  mock: new MockAdapter(),
  rss: new RssAdapter(),
  crawl: new CrawlAdapter(),
  "wechat-url": new WechatUrlAdapter(),
  "ai-generated": new AiCrawlerAdapter(),
};

function hasConfiguredTarget(source: IntelSource) {
  if (source.kind === "mock") return true;
  if (source.kind === "rss") return Boolean(source.url);
  return Boolean(source.urls?.length);
}

async function collectOne(source: IntelSource): Promise<{
  records: RawIntelRecord[];
  report: SourceRunReport;
}> {
  const startedAt = Date.now();

  if (!hasConfiguredTarget(source)) {
    return {
      records: [],
      report: {
        sourceId: source.id,
        sourceName: source.name,
        kind: source.kind,
        status: "skipped",
        itemCount: 0,
        elapsedMs: Date.now() - startedAt,
        message: "No URL configured for this source.",
      },
    };
  }

  try {
    const records = await adapterRegistry[source.kind].collect(source);

    return {
      records,
      report: {
        sourceId: source.id,
        sourceName: source.name,
        kind: source.kind,
        status: "fulfilled",
        itemCount: records.length,
        elapsedMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    return {
      records: [],
      report: {
        sourceId: source.id,
        sourceName: source.name,
        kind: source.kind,
        status: "failed",
        itemCount: 0,
        elapsedMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Unknown collection failure.",
      },
    };
  }
}

export async function runMockBackendIngestion(kinds?: SourceKind[]) {
  const selectedSources = kinds?.length ? sourceCatalog.filter((source) => kinds.includes(source.kind)) : sourceCatalog;
  const results = await Promise.all(selectedSources.map(collectOne));

  return {
    generatedAt: new Date().toISOString(),
    records: results.flatMap((result) => result.records),
    reports: results.map((result) => result.report),
  };
}

export function getBackendOverview(): BackendOverview {
  const llm = getLlmSettings();

  return {
    generatedAt: new Date().toISOString(),
    mode: "mock-backend",
    contracts: {
      feed: "GET /api/feed -> DashboardData",
      briefing: "GET /api/briefing -> { briefing: BriefingSection[] }",
      chat: "POST /api/chat -> { answer: string }",
    },
    llm: {
      provider: "openai-compatible",
      configured: llm.configured,
      model: llm.model,
      baseURL: llm.baseURL,
    },
    rss: {
      sourceCount: rssSources.length,
      urls: rssSources,
      spec: [
        "RSS 2.0: rss.channel.item.title/link/description/pubDate",
        "Atom: feed.entry.title/link/summary|content/published|updated",
        "HTML is stripped before scoring and LLM summarization.",
      ],
    },
    crawl: {
      targetCount: crawlUrls.length,
      urls: crawlUrls,
      policy: [
        "Only fetch explicitly configured public URLs.",
        "No login, anti-bot bypass, or private-content scraping.",
        "Extract title, meta description, article paragraphs, URL, and fetch timestamp.",
      ],
    },
  };
}

export function listBackendSources() {
  return sourceCatalog.map((source) => ({
    id: source.id,
    kind: source.kind,
    name: source.name,
    region: source.region,
    reliabilityScore: source.reliabilityScore,
    tags: source.tags,
    url: source.url,
    urls: source.urls ?? [],
    configured: hasConfiguredTarget(source),
  }));
}
