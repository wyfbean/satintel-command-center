import type { IntelSource } from "@/types/intel";

/**
 * Default RSS sources. Broadened beyond SpaceNews + NASA to a wider set of
 * space / satellite / Earth-observation feeds so the corpus has enough volume
 * for ranking and (later) a recommendation model. Override with the
 * comma-separated SATINTEL_RSS_SOURCES env var.
 */
const defaultRssSources = [
  "https://spacenews.com/feed/",
  "https://www.nasa.gov/rss/dyn/breaking_news.rss",
  "https://www.space.com/feeds/all",
  "https://spaceflightnow.com/feed/",
  "https://phys.org/rss-feed/space-news/",
  "https://www.esa.int/rssfeed/Our_Activities/Observing_the_Earth",
  "https://arstechnica.com/space/feed/",
  "https://www.satellitetoday.com/feed/",
  "https://eos.org/feed",
];

/** Per-feed item cap. Relaxed from 20 → 50 to broaden the fetch range. */
export const rssItemLimit = Number(process.env.SATINTEL_RSS_LIMIT) || 50;

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

/** Display metadata aligned (by index) to `defaultRssSources`. */
const rssMeta: Array<Pick<IntelSource, "id" | "name" | "region" | "reliabilityScore" | "tags">> = [
  { id: "space-rss-1", name: "SpaceNews 订阅源", region: "全球", reliabilityScore: 0.86, tags: ["发射", "产业", "政策"] },
  { id: "space-rss-2", name: "NASA 快讯", region: "美国", reliabilityScore: 0.92, tags: ["任务", "科研", "EO"] },
  { id: "space-rss-3", name: "Space.com", region: "全球", reliabilityScore: 0.8, tags: ["航天", "探索", "科普"] },
  { id: "space-rss-4", name: "Spaceflight Now", region: "全球", reliabilityScore: 0.84, tags: ["发射", "任务"] },
  { id: "space-rss-5", name: "Phys.org 航天", region: "全球", reliabilityScore: 0.82, tags: ["科研", "天文"] },
  { id: "space-rss-6", name: "ESA 对地观测", region: "欧洲", reliabilityScore: 0.9, tags: ["对地观测", "EO", "遥感"] },
  { id: "space-rss-7", name: "Ars Technica 航天", region: "全球", reliabilityScore: 0.82, tags: ["产业", "技术"] },
  { id: "space-rss-8", name: "Via Satellite", region: "全球", reliabilityScore: 0.83, tags: ["卫星", "通信", "产业"] },
  { id: "space-rss-9", name: "EOS 地球科学", region: "全球", reliabilityScore: 0.82, tags: ["地球科学", "遥感", "EO"] },
];

export const sourceCatalog: IntelSource[] = [
  ...rssSources.map((url, i) => {
    const meta = rssMeta[i] ?? {
      id: `space-rss-${i + 1}`,
      name: `RSS 源 ${i + 1}`,
      region: "全球",
      reliabilityScore: 0.78,
      tags: ["资讯"],
    };
    return { ...meta, kind: "rss" as const, url };
  }),
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
