"use client";

import "@copilotkit/react-ui/styles.css";

import { useMemo, useState, useTransition } from "react";
import { CopilotKit, useCoAgent, useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";

import { SiteNav } from "@/components/site-nav";
import { RssManager } from "@/components/dashboard/rss-manager";
import { TrendDashboard } from "@/components/home/trend-dashboard";
import { NewsFeed } from "@/components/home/news-feed";
import { frontendMockDashboardData } from "@/lib/mock/frontend-dashboard";
import type { DashboardAgentState } from "@/lib/a2a/dashboard-agent";
import type { DashboardData, IntelItem } from "@/types/intel";

const AGENT_NAME = "satellite_dashboard";
const useFrontendMock = process.env.NEXT_PUBLIC_FEED_MODE === "mock";

/* ── map server DashboardData → AG-UI agent state (hero seed) ──────── */

function toAgentState(d: DashboardData): DashboardAgentState {
  return {
    generatedAt: d.generatedAt,
    llmConfigured: d.sourceSummary.llmConfigured,
    items: d.items.slice(0, 12),
    trends: d.trends,
    sourceSummary: d.sourceSummary,
    briefing: d.briefing,
  };
}

/* ── public export ────────────────────────────────────────────────── */

export function HomeShell({ initialData }: { initialData: DashboardData }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_NAME}>
      <HomeWorkspace initialData={initialData} />
    </CopilotKit>
  );
}

/* ── workspace (inside CopilotKit so hooks are available) ─────────── */

function HomeWorkspace({ initialData }: { initialData: DashboardData }) {
  const bootData = useFrontendMock ? frontendMockDashboardData : initialData;

  const [feedData, setFeedData] = useState<DashboardData>(bootData);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<IntelItem | null>(null);
  const [rssOpen, setRssOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Top "今日趋势" hero is driven by the AG-UI agent's STATE_SNAPSHOT, seeded
  // from the server fetch so it renders instantly without a blank flash.
  const seedState = useMemo(() => toAgentState(bootData), [bootData]);
  const { state, setState: setAgentState } = useCoAgent<DashboardAgentState>({
    name: AGENT_NAME,
    initialState: seedState,
  });
  // During SSR / before the first snapshot, `state` may be undefined or an
  // empty object — merge over the seed so every field is always present.
  const agentState: DashboardAgentState = { ...seedState, ...(state ?? {}) };

  const sources = useMemo(
    () => Array.from(new Set(feedData.items.map((i) => i.sourceName))).filter(Boolean),
    [feedData.items],
  );

  // Chat-driven source filter (the official CopilotKit frontend-action loop).
  useCopilotAction({
    name: "filterBySource",
    description: "按来源名称筛选下方的资讯流。",
    parameters: [{ name: "source", type: "string", description: "要筛选的来源名称", required: true }],
    handler: ({ source }: { source: string }) => {
      const matched = sources.find((n) => n === source || n.includes(source));
      setActiveSource(matched ?? null);
    },
  });

  // chat-to-widget: render any tool call inline in the chat popup.
  useCopilotAction({
    name: "*",
    render: ({ name, status, result }: { name: string; status: string; result: unknown }) => (
      <div className="my-2 rounded-xl border border-[#dbe4ff] bg-white px-3 py-2 text-xs shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono font-semibold text-[#2f62d9]">🛠 {name}</span>
          <span className="rounded-full bg-[#fef9c3] px-2 py-0.5 text-[10px] text-[#854d0e]">
            {status === "complete" ? "完成" : "执行中"}
          </span>
        </div>
        {Boolean(result) && (
          <div className="mt-1 truncate text-slate-400">
            {(typeof result === "string" ? result : JSON.stringify(result)).slice(0, 96)}
          </div>
        )}
      </div>
    ),
  });

  // Ground the agent in what the operator currently sees.
  useCopilotReadable({
    description: "首页当前界面状态",
    value: {
      activeSourceFilter: activeSource ?? "全部数据源",
      selectedArticle: selectedItem
        ? { title: selectedItem.title, summary: selectedItem.summary, source: selectedItem.sourceName }
        : null,
      trends: agentState.trends.map((t) => `${t.label}(${t.count})`),
      visibleSources: sources,
    },
  });

  async function refreshFeed() {
    if (useFrontendMock) {
      setFeedData(frontendMockDashboardData);
      setAgentState(toAgentState(frontendMockDashboardData));
      setSelectedItem(null);
      return;
    }
    await fetch("/api/crawl/trigger", { method: "POST" }).catch(() => {});
    const r = await fetch("/api/feed");
    const d = (await r.json()) as DashboardData;
    setFeedData(d);
    setAgentState(toAgentState(d)); // keep the AG-UI hero in sync
    setSelectedItem(null);
  }

  return (
    <main className="panel-grid min-h-screen px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-6">

        {/* floating pill nav */}
        <header>
          <div className="mx-auto flex w-full max-w-[1100px] items-center justify-between rounded-full border border-[#d0d8e8] bg-white px-5 py-4 shadow-[0_14px_36px_rgba(28,42,71,0.10)]">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1a1f2e] text-sm font-semibold text-white">轨道</div>
              <div>
                <div className="text-sm font-semibold text-slate-900">卫星情报首页</div>
                <div className="text-xs text-slate-400">今日趋势面板 · 资讯流 · AI 追问</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <SiteNav />
              <button
                type="button"
                onClick={() => setRssOpen(true)}
                className="flex items-center gap-1.5 rounded-full border border-[#c8d0e0] bg-[#f4f7ff] px-3 py-2 text-xs font-medium text-[#2a55cc] hover:bg-[#e8f0ff] hover:border-[#3d74ff] transition"
              >
                RSS
              </button>
            </div>
          </div>
        </header>

        <RssManager open={rssOpen} onClose={() => setRssOpen(false)} onChanged={() => void refreshFeed()} />

        {/* top: AG-UI driven trend dashboard */}
        <TrendDashboard state={agentState} />

        {/* sunken: news feed */}
        <NewsFeed
          data={feedData}
          activeSource={activeSource}
          onClearSource={() => setActiveSource(null)}
          onSelect={setSelectedItem}
          onRefresh={() => startTransition(() => void refreshFeed())}
          isRefreshing={isPending}
        />
      </div>

      {/* hidden-behind-a-button chat (floating bubble + popup) */}
      <CopilotPopup
        defaultOpen={false}
        labels={{
          title: "卫星数据助手",
          initial: "你好，我基于今日趋势面板与资讯流作答，也可帮你按来源筛选。试试「筛选 NASA 快讯」。",
          placeholder: "询问某个来源、地区或主题……",
        }}
      />
    </main>
  );
}
