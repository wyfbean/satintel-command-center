export type SourceKind = "mock" | "rss" | "wechat-url";

export type IntelSource = {
  id: string;
  kind: SourceKind;
  name: string;
  region: string;
  reliabilityScore: number;
  tags: string[];
  url?: string;
  urls?: string[];
};

export type RawIntelRecord = {
  id: string;
  sourceId: string;
  sourceName: string;
  channel: SourceKind;
  title: string;
  excerpt: string;
  body: string;
  url: string;
  publishedAt: string;
  tags: string[];
  region: string;
  imageryModes: Array<"RGB" | "SAR" | "MS">;
};

export type IntelItem = RawIntelRecord & {
  summary: string;
  whyItMatters: string;
  extractedEntities: string[];
  freshnessScore: number;
  relevanceScore: number;
  urgencyScore: number;
  compositeScore: number;
  trendKey: string;
  sourceLabel: string;
  timelineLabel: string;
};

export type TrendSignal = {
  label: string;
  count: number;
  delta: string;
  stance: "up" | "steady";
};

export type PhaseScore = {
  phase: string;
  achieved: number;
  target: number;
  note: string;
};

export type BriefingSection = {
  heading: string;
  body: string;
};

export type DashboardData = {
  generatedAt: string;
  items: IntelItem[];
  trends: TrendSignal[];
  briefing: BriefingSection[];
  dateTitle: string;
  hero: {
    eyebrow: string;
    title: string;
    description: string;
  };
  sourceSummary: {
    totalSources: number;
    liveSources: number;
    totalItems: number;
    llmConfigured: boolean;
  };
  scorecard: PhaseScore[];
  filters: {
    sources: string[];
    tags: string[];
  };
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};
