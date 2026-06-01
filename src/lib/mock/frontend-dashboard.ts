import { extractTrendSignals, toIntelItem } from "@/lib/intel/scoring";
import { seededIntelRecords } from "@/lib/mock/articles";
import type { DashboardData } from "@/types/intel";

const items = seededIntelRecords
  .map(toIntelItem)
  .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime());

export const frontendMockDashboardData: DashboardData = {
  generatedAt: "2026-05-23T09:30:00.000Z",
  dateTitle: "2026.05.23",
  hero: {
    eyebrow: "前端 Mock 数据 · 可独立调试",
    title: "卫星情报资讯流",
    description: "当前页面使用本地 mock 新闻渲染，前端滚动、选中和 Ask AI 面板可以脱离后端抓取先行调试。",
  },
  items,
  trends: extractTrendSignals(items),
  briefing: [
    {
      heading: "今日概览",
      body: "当前 mock 资讯集中在 SAR 重访、高光谱农业、汛期政务看板、响应式成像合同和山火应急任务。",
    },
    {
      heading: "优先关注",
      body: "政务采购与应急响应是最值得跟进的两条线，尤其是高频 SAR、RGB/SAR 组合和跨部门简报系统。",
    },
    {
      heading: "建议动作",
      body: "先验证滚动激活、新闻锚点、右侧摘要同步和 Ask AI 上下文，再切换到实时 RSS/API 调试。",
    },
  ],
  sourceSummary: {
    totalSources: 1,
    liveSources: 0,
    totalItems: items.length,
    llmConfigured: false,
  },
  scorecard: [],
  filters: {
    sources: Array.from(new Set(items.map((item) => item.sourceName))),
    tags: Array.from(new Set(items.flatMap((item) => item.tags))).slice(0, 12),
    regions: Array.from(new Set(items.map((item) => item.region).filter(Boolean))).sort(),
  },
};
