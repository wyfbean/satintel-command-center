import type { IntelItem, RawIntelRecord, TrendSignal } from "@/types/intel";

const relevanceKeywords = [
  "satellite",
  "remote sensing",
  "earth observation",
  "constellation",
  "launch",
  "sar",
  "optical",
  "multispectral",
  "hyperspectral",
  "imagery",
  "卫星",
  "遥感",
  "星座",
];

const urgencyKeywords = [
  "delay",
  "contract",
  "wildfire",
  "flood",
  "emergency",
  "disaster",
  "defense",
  "launch",
  "procurement",
  "outage",
  "milestone",
];

function scoreKeywordHits(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  return keywords.reduce((score, keyword) => score + (lower.includes(keyword) ? 1 : 0), 0);
}

function computeFreshnessScore(publishedAt: string) {
  const ageHours = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 3_600_000);

  if (ageHours <= 6) return 1;
  if (ageHours <= 24) return 0.84;
  if (ageHours <= 48) return 0.62;
  if (ageHours <= 72) return 0.44;

  return 0.24;
}

function toSentenceCase(input: string) {
  return input.charAt(0).toUpperCase() + input.slice(1);
}

function inferEntities(record: RawIntelRecord) {
  const candidates = [
    record.sourceName,
    ...record.tags,
    ...record.title.split(" ").filter((token) => /^[A-Z][A-Za-z-]{2,}$/.test(token)),
  ];

  return Array.from(new Set(candidates)).slice(0, 6);
}

function buildWhyItMatters(record: RawIntelRecord) {
  const tagLead = record.tags.slice(0, 2).join(" + ");
  return `${toSentenceCase(tagLead || "Signal")} 直接影响采集排期、下游采购需求或任务响应节奏。`;
}

function buildSummary(record: RawIntelRecord) {
  const firstSentence = record.body.split(/[.!?]/).find((sentence) => sentence.trim().length > 18)?.trim();
  return firstSentence ?? record.excerpt;
}

function buildTrendKey(record: RawIntelRecord) {
  return record.tags[0] ?? "general";
}

function buildSourceLabel(channel: RawIntelRecord["channel"]) {
  if (channel === "rss") return "RSS";
  if (channel === "wechat-url") return "微信抓取";
  return "AI 抓取";
}

export function toIntelItem(record: RawIntelRecord): IntelItem {
  const context = `${record.title} ${record.excerpt} ${record.body}`;
  const relevanceScore = Math.min(1, 0.35 + scoreKeywordHits(context, relevanceKeywords) * 0.12);
  const urgencyScore = Math.min(1, 0.28 + scoreKeywordHits(context, urgencyKeywords) * 0.14);
  const freshnessScore = computeFreshnessScore(record.publishedAt);
  const compositeScore = Number((freshnessScore * 0.3 + relevanceScore * 0.42 + urgencyScore * 0.28).toFixed(3));

  return {
    ...record,
    summary: buildSummary(record),
    whyItMatters: buildWhyItMatters(record),
    extractedEntities: inferEntities(record),
    freshnessScore,
    relevanceScore,
    urgencyScore,
    compositeScore,
    trendKey: buildTrendKey(record),
    sourceLabel: buildSourceLabel(record.channel),
    timelineLabel: record.tags[0] ?? record.sourceName,
  };
}

export function dedupeAndRank(records: RawIntelRecord[]) {
  const map = new Map<string, RawIntelRecord>();

  for (const record of records) {
    const key = `${record.title.toLowerCase().trim()}::${record.url}`;

    if (!map.has(key)) {
      map.set(key, record);
    }
  }

  return Array.from(map.values())
    .map(toIntelItem)
    .sort((left, right) => right.compositeScore - left.compositeScore);
}

export function extractTrendSignals(items: IntelItem[]): TrendSignal[] {
  const bucket = new Map<string, number>();

  for (const item of items) {
    for (const tag of item.tags.slice(0, 3)) {
      bucket.set(tag, (bucket.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(bucket.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([label, count], index) => ({
      label,
      count,
      delta: index < 3 ? `+${count * 3}%` : `+${count}%`,
      stance: index < 3 ? "up" : "steady",
    }));
}
