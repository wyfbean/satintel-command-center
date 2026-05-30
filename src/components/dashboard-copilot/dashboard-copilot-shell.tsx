"use client";

import "@copilotkit/react-ui/styles.css";

import { useEffect, useMemo, useState } from "react";
import { CopilotKit, useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";

import { SiteNav } from "@/components/site-nav";
import type { DashboardData } from "@/types/intel";

const AGENT_NAME = "satellite_dashboard";

const emptySourceSummary: DashboardData["sourceSummary"] = {
  totalSources: 0,
  liveSources: 0,
  totalItems: 0,
  llmConfigured: false,
};

export function DashboardCopilotShell() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_NAME}>
      <DashboardCopilotWorkspace />
    </CopilotKit>
  );
}

function DashboardCopilotWorkspace() {
  // Panels are populated directly from the stable /api/feed contract — decoupled
  // from the chat agent so they always render. The CopilotChat agent
  // (satellite_dashboard) handles conversation + the filterBySource action.
  const [data, setData] = useState<DashboardData | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/feed")
      .then((r) => r.json())
      .then((d: DashboardData) => {
        if (active) setData(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const state = {
    items: data?.items ?? [],
    trends: data?.trends ?? [],
    briefing: data?.briefing ?? [],
    sourceSummary: data?.sourceSummary ?? emptySourceSummary,
    llmConfigured: data?.sourceSummary.llmConfigured ?? false,
  };

  const sources = useMemo(
    () => Array.from(new Set(state.items.map((item) => item.sourceName))).filter(Boolean),
    [state.items],
  );
  const visibleItems = useMemo(
    () => (activeSource ? state.items.filter((item) => item.sourceName === activeSource) : state.items),
    [state.items, activeSource],
  );

  // Frontend-action loop: the agent can call this to filter the feed by source.
  useCopilotAction({
    name: "filterBySource",
    description: "按来源名称筛选当前可见的卫星资讯流。",
    parameters: [{ name: "source", type: "string", description: "要筛选的来源名称", required: true }],
    handler: ({ source }: { source: string }) => {
      const matched = sources.find((name) => name === source || name.includes(source));
      setActiveSource(matched ?? null);
    },
  });

  // Expose what the operator currently sees so chat answers stay grounded in it.
  useCopilotReadable({
    description: "卫星数据对话面板当前界面状态",
    value: {
      activeSourceFilter: activeSource ?? "全部数据源",
      visibleCount: visibleItems.length,
      visibleTitles: visibleItems.slice(0, 6).map((item) => item.title),
      trends: state.trends.map((trend) => `${trend.label}(${trend.count})`),
    },
  });

  return (
    <main className="panel-grid min-h-screen px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-7">
        <header className="rounded-[34px] border border-[#ebedf2] bg-white/90 p-5 shadow-[0_18px_44px_rgba(28,42,71,0.08)] backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1f2430] text-sm font-semibold text-white">
                A2UI
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">卫星数据对话面板</div>
                <div className="text-xs text-slate-400">
                  数据面板 · {state.llmConfigured ? "LLM 已接入" : "确定性回退模式"}
                </div>
              </div>
            </div>
            <SiteNav />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="数据条目" value={state.sourceSummary.totalItems || state.items.length} />
            <Metric label="活跃数据源" value={state.sourceSummary.liveSources || sources.length} tone="text-[#15803d]" />
            <Metric label="趋势信号" value={state.trends.length} tone="text-[#b7791f]" />
            <Metric label="当前筛选" value={activeSource ?? "全部"} />
          </div>
        </header>

        <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
          <div className="min-w-0 space-y-6">
            <Panel kicker="Source Filter" title="数据源筛选（可由对话驱动）">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSource(null)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    activeSource === null
                      ? "border-[#3d74ff] bg-[#f4f7ff] text-[#2f62d9]"
                      : "border-[#e8ebf0] bg-white text-slate-600 hover:border-[#cfdcff]"
                  }`}
                >
                  全部数据源
                </button>
                {sources.map((source) => (
                  <button
                    key={source}
                    type="button"
                    onClick={() => setActiveSource(source)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      activeSource === source
                        ? "border-[#3d74ff] bg-[#f4f7ff] text-[#2f62d9]"
                        : "border-[#e8ebf0] bg-white text-slate-600 hover:border-[#cfdcff]"
                    }`}
                  >
                    {source}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                试着在右侧对话框输入“筛选 {sources[0] ?? "某个数据源"} 的数据”，让助手驱动筛选。
              </p>
            </Panel>

            <Panel kicker="Live Data" title={`数据流（${visibleItems.length}）`}>
              {visibleItems.length === 0 ? (
                <Empty>正在加载数据……</Empty>
              ) : (
                <div className="space-y-3">
                  {visibleItems.map((item) => (
                    <article key={item.id} className="rounded-[20px] border border-[#ebedf2] bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                        <span className="shrink-0 rounded-full bg-[#f4f7ff] px-2.5 py-1 text-xs text-[#3d74ff]">
                          {item.sourceLabel || item.sourceName}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-500">{item.summary}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="rounded-full bg-[#fbfbfc] px-2 py-1">{item.region}</span>
                        {item.imageryModes.map((mode) => (
                          <span key={mode} className="rounded-full bg-[#f6f8fb] px-2 py-1">
                            {mode}
                          </span>
                        ))}
                        <span className="ml-auto font-mono">score {item.compositeScore}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <div className="grid gap-6 md:grid-cols-2">
              <Panel kicker="Trends" title="主题趋势">
                {state.trends.length === 0 ? (
                  <Empty>暂无趋势信号。</Empty>
                ) : (
                  <div className="space-y-2">
                    {state.trends.map((trend) => (
                      <div
                        key={trend.label}
                        className="flex items-center justify-between rounded-[16px] bg-[#fbfbfc] px-4 py-3 text-sm"
                      >
                        <span className="text-slate-700">{trend.label}</span>
                        <span className={trend.stance === "up" ? "text-[#15803d]" : "text-slate-400"}>
                          {trend.count} · {trend.delta}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel kicker="Briefing" title="运营简报">
                {state.briefing.length === 0 ? (
                  <Empty>暂无简报。</Empty>
                ) : (
                  <div className="space-y-3">
                    {state.briefing.map((section) => (
                      <div key={section.heading}>
                        <div className="text-sm font-semibold text-slate-900">{section.heading}</div>
                        <p className="mt-1 text-sm leading-6 text-slate-500">{section.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          </div>

          <aside className="xl:sticky xl:top-6">
            <div className="flex h-[78vh] flex-col overflow-hidden rounded-[30px] border border-[#ebedf2] bg-white shadow-[0_14px_34px_rgba(28,42,71,0.06)]">
              <div className="border-b border-[#eff1f4] px-5 py-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">CopilotKit Chat</div>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">与卫星数据对话</h2>
              </div>
              <div className="min-h-0 flex-1">
                <CopilotChat
                  className="h-full"
                  labels={{
                    title: "卫星数据助手",
                    initial: "你好，我可以基于当前数据回答问题，并按数据源筛选。试试“筛选某数据源的数据”。",
                    placeholder: "询问某个数据源、地区或主题……",
                  }}
                />
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, tone = "text-slate-900" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-[20px] border border-[#ebedf2] bg-[#fafbff] p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-2 truncate text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function Panel({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[28px] border border-[#ebedf2] bg-white p-5 shadow-[0_14px_34px_rgba(28,42,71,0.06)]">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">{kicker}</div>
      <h2 className="mt-2 text-xl font-semibold text-slate-900">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[16px] bg-[#fbfbfc] px-4 py-6 text-center text-sm text-slate-400">{children}</div>;
}
