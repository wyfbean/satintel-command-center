"use client";

import "@copilotkit/react-ui/styles.css";

import { useEffect, useMemo, useState } from "react";
import { CopilotKit, useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { AppSidebar } from "@/components/app-sidebar";

import type { DashboardData, IntelItem, TrendSignal } from "@/types/intel";

const AGENT_NAME = "satellite_dashboard";

/* ── shell export ─────────────────────────────────────────────────── */

export function DashboardCopilotShell() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_NAME}>
      <div className="flex h-screen overflow-hidden bg-[#f4f5f7] font-sans text-slate-900">
        <AppSidebar />
        <DashboardMain />
      </div>
    </CopilotKit>
  );
}

/* ── main content + chat ──────────────────────────────────────────── */

function DashboardMain() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<IntelItem | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/feed")
      .then((r) => r.json())
      .then((d: DashboardData) => { if (active) setData(d); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const items = data?.items ?? [];
  const trends = data?.trends ?? [];
  const briefing = data?.briefing ?? [];
  const sourceSummary = data?.sourceSummary ?? { totalSources: 0, liveSources: 0, totalItems: 0, llmConfigured: false };

  const sources = useMemo(
    () => Array.from(new Set(items.map((i) => i.sourceName))).filter(Boolean),
    [items],
  );
  const visibleItems = useMemo(
    () => (activeSource ? items.filter((i) => i.sourceName === activeSource) : items),
    [items, activeSource],
  );

  useCopilotAction({
    name: "filterBySource",
    description: "按来源名称筛选当前可见的卫星数据流。",
    parameters: [{ name: "source", type: "string", description: "要筛选的来源名称", required: true }],
    handler: ({ source }: { source: string }) => {
      const matched = sources.find((n) => n === source || n.includes(source));
      setActiveSource(matched ?? null);
    },
  });

  useCopilotReadable({
    description: "卫星数据面板当前界面状态",
    value: {
      activeSourceFilter: activeSource ?? "全部数据源",
      visibleCount: visibleItems.length,
      visibleTitles: visibleItems.slice(0, 6).map((i) => i.title),
      trends: trends.map((t) => `${t.label}(${t.count})`),
    },
  });

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* left scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-5">
          {/* header */}
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">数据面板</h1>
              <p className="mt-0.5 text-sm text-slate-400">
                卫星情报综合概览 · {sourceSummary.llmConfigured ? "LLM 已接入" : "演示模式"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SourceFilter sources={sources} active={activeSource} onChange={setActiveSource} />
              <button
                type="button"
                onClick={() => { setData(null); fetch("/api/feed").then((r) => r.json()).then(setData).catch(() => {}); }}
                className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-[#f8fafc]"
              >
                刷新
              </button>
            </div>
          </div>

          {/* KPI row */}
          <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KpiCard
              title="数据条目"
              value={String(sourceSummary.totalItems || visibleItems.length)}
              delta="+12.5%"
              up
              icon="📡"
            />
            <KpiCard
              title="活跃数据源"
              value={String(sourceSummary.liveSources || sources.length)}
              delta="+8.2%"
              up
              icon="🛰️"
            />
            <KpiCard
              title="趋势信号"
              value={String(trends.length)}
              delta="+15.8%"
              up
              icon="📈"
            />
            <KpiCard
              title="当前筛选"
              value={activeSource ? "已筛选" : "全部"}
              delta={activeSource ? `${visibleItems.length} 条` : `共 ${items.length} 条`}
              up={false}
              icon="🔍"
            />
          </div>

          {/* trend chart + briefing */}
          <div className="mb-5 grid gap-4 xl:grid-cols-[1fr_300px]">
            <TrendChart trends={trends} />
            <BriefingPanel sections={briefing} />
          </div>

          {/* items table + source breakdown */}
          <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
            <ItemsTable items={visibleItems} onSelect={setSelectedItem} selected={selectedItem} />
            <SourceBreakdown items={items} active={activeSource} onSelect={setActiveSource} />
          </div>
        </div>
      </div>

      {/* right chat panel */}
      <div className="flex w-[360px] flex-none flex-col border-l border-[#e2e8f0] bg-white xl:w-[400px]">
        <div className="border-b border-[#e2e8f0] px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">卫星数据 AI</div>
              <div className="mt-0.5 text-xs text-slate-400">由数据面板内容驱动</div>
            </div>
            <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-medium text-[#15803d]">在线</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <CopilotChat
            className="h-full"
            labels={{
              title: "卫星数据助手",
              initial: "你好，我可以基于当前数据回答问题，并按数据源筛选。",
              placeholder: "询问某个数据源、地区或主题……",
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── KPI card ─────────────────────────────────────────────────────── */

function KpiCard({ title, value, delta, up, icon }: { title: string; value: string; delta: string; up: boolean; icon: string }) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xl">{icon}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${up ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#f1f5f9] text-slate-500"}`}>
          {up ? "↑" : ""} {delta}
        </span>
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{title}</div>
    </div>
  );
}

/* ── trend spark chart ────────────────────────────────────────────── */

function TrendChart({ trends }: { trends: TrendSignal[] }) {
  const maxCount = Math.max(1, ...trends.map((t) => t.count));
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">主题趋势</h2>
          <p className="text-xs text-slate-400">当前数据集中的信号强度</p>
        </div>
      </div>
      {trends.length === 0 ? (
        <div className="flex h-28 items-center justify-center text-sm text-slate-400">暂无趋势数据</div>
      ) : (
        <div className="space-y-3">
          {trends.slice(0, 6).map((t) => (
            <div key={t.label} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-xs text-slate-600">{t.label}</span>
              <div className="flex-1 overflow-hidden rounded-full bg-[#f1f5f9]">
                <div
                  className="h-2 rounded-full bg-[#3d74ff] transition-all"
                  style={{ width: `${Math.round((t.count / maxCount) * 100)}%` }}
                />
              </div>
              <span className={`w-10 text-right text-xs font-medium ${t.stance === "up" ? "text-[#15803d]" : "text-slate-400"}`}>
                {t.count}
              </span>
              <span className="w-12 text-right text-xs text-slate-400">{t.delta}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── briefing panel ───────────────────────────────────────────────── */

function BriefingPanel({ sections }: { sections: Array<{ heading: string; body: string }> }) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-slate-900">情报简报</h2>
      {sections.length === 0 ? (
        <div className="flex h-28 items-center justify-center text-sm text-slate-400">加载中…</div>
      ) : (
        <div className="space-y-4">
          {sections.map((s) => (
            <div key={s.heading}>
              <div className="mb-1 text-xs font-semibold text-[#3d74ff]">{s.heading}</div>
              <p className="text-xs leading-5 text-slate-500">{s.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── items table ──────────────────────────────────────────────────── */

const IMAGERY_COLOR: Record<string, string> = { RGB: "bg-[#dbeafe] text-[#1d4ed8]", SAR: "bg-[#fef9c3] text-[#854d0e]", MS: "bg-[#dcfce7] text-[#15803d]" };

function ItemsTable({ items, onSelect, selected }: { items: IntelItem[]; onSelect: (item: IntelItem | null) => void; selected: IntelItem | null }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#e2e8f0] px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">最新数据条目</h2>
        <span className="text-xs text-slate-400">共 {items.length} 条</span>
      </div>
      <div className="divide-y divide-[#f1f5f9]">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">加载中…</div>
        ) : (
          items.slice(0, 8).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(selected?.id === item.id ? null : item)}
              className={`w-full px-5 py-3 text-left transition hover:bg-[#f8fafc] ${selected?.id === item.id ? "bg-[#f0f6ff]" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{item.title}</div>
                  {selected?.id === item.id && (
                    <p className="mt-1 text-xs leading-5 text-slate-500">{item.summary}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                    <span>{item.sourceName}</span>
                    <span>·</span>
                    <span>{item.region}</span>
                    {item.imageryModes.map((m) => (
                      <span key={m} className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${IMAGERY_COLOR[m] ?? "bg-[#f1f5f9] text-slate-500"}`}>{m}</span>
                    ))}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-xs text-slate-400">{item.compositeScore.toFixed(2)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ── source breakdown ─────────────────────────────────────────────── */

function SourceBreakdown({ items, active, onSelect }: { items: IntelItem[]; active: string | null; onSelect: (s: string | null) => void }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of items) m.set(item.sourceName, (m.get(item.sourceName) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);
  const total = items.length || 1;

  return (
    <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
      <div className="border-b border-[#e2e8f0] px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">数据源分布</h2>
      </div>
      <div className="divide-y divide-[#f1f5f9]">
        {counts.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-slate-400">加载中…</div>
        ) : (
          counts.map(([src, cnt]) => (
            <button
              key={src}
              type="button"
              onClick={() => onSelect(active === src ? null : src)}
              className={`flex w-full items-center justify-between px-5 py-3 text-left text-sm transition hover:bg-[#f8fafc] ${active === src ? "bg-[#f0f6ff]" : ""}`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{src}</div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[#f1f5f9]">
                  <div className="h-full rounded-full bg-[#3d74ff]" style={{ width: `${Math.round((cnt / total) * 100)}%` }} />
                </div>
              </div>
              <span className="ml-4 shrink-0 text-xs font-medium text-slate-500">{cnt}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ── source filter dropdown ───────────────────────────────────────── */

function SourceFilter({ sources, active, onChange }: { sources: string[]; active: string | null; onChange: (s: string | null) => void }) {
  return (
    <select
      value={active ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-[#f8fafc]"
    >
      <option value="">全部数据源</option>
      {sources.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

