import type { IntelSource } from "@/types/intel";

const defaultRssSources = [
  "https://spacenews.com/feed/",
  "https://www.nasa.gov/rss/dyn/breaking_news.rss",
];

export const rssSources =
  process.env.SATINTEL_RSS_SOURCES?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? defaultRssSources;

export const wechatUrls =
  process.env.SATINTEL_WECHAT_URLS?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];

export const crawlUrls =
  process.env.SATINTEL_CRAWL_URLS?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? wechatUrls;

export const sourceCatalog: IntelSource[] = [
  {
    id: "space-rss-1",
    kind: "rss",
    name: "SpaceNews 订阅源",
    region: "全球",
    reliabilityScore: 0.86,
    tags: ["发射", "产业", "政策"],
    url: rssSources[0],
  },
  {
    id: "space-rss-2",
    kind: "rss",
    name: "NASA 快讯",
    region: "美国",
    reliabilityScore: 0.92,
    tags: ["任务", "科研", "EO"],
    url: rssSources[1],
  },
  // NOTE: crawl / wechat-url / ai-generated sources are temporarily unwired
  // (RSS-only mode). The adapter code is kept; re-add entries here to restore.
  {
    id: "seed-satellite-lab",
    kind: "mock",
    name: "轨道情报实验室",
    region: "混合",
    reliabilityScore: 0.7,
    tags: ["种子", "卫星"],
  },
];
