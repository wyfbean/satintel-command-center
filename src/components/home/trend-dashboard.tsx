"use client";

import type { DashboardAgentState } from "@/lib/a2a/dashboard-agent";
import type { BriefingSection, IntelItem, TrendSignal } from "@/types/intel";

/**
 * AG-UI 驱动的「今日趋势」hero。
 *
 * 数据完全来自 `satellite_dashboard` 智能体的 STATE_SNAPSHOT（经 useCoAgent
 * 在 home-shell 中消费），并由服务端 getDashboardData() 作为初始种子。聊天里
 * 触发智能体 run 后，快照会刷新这里的 KPI / 趋势 / 简报。
 */

function todayParts() {
  const now = new Date();
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return { day: now.getDate(), month: now.getMonth() + 1, weekday: weekdays[now.getDay()] };
}

function formatDateTime(isoString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(isoString));
}

type Props = { state: DashboardAgentState; briefingOverride?: BriefingSection[] | null };

export function TrendDashboard({ state, briefingOverride }: Props) {
  const trends = state.trends ?? [];
  // A chat-optimised briefing (via the updateBriefing tool) wins over the snapshot.
  const briefing = briefingOverride ?? state.briefing ?? [];
  const sourceSummary = state.sourceSummary ?? { totalSources: 0, liveSources: 0, totalItems: 0, llmConfigured: false };
  const { day, month, weekday } = todayParts();
  const topThemes = trends.slice(0, 3).map((t) => t.label).join("、") || "高频成像、政务采购、星座部署";

  return (
    <section className="space-y-5">
      {/* heading */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">今日趋势</div>
          <h2 className="mt-1.5 flex items-center gap-2 text-2xl font-semibold text-slate-900">
            智能体数据面板
            {state.appliedSource && (
              <span className="rounded-full bg-[#eef4ff] px-2.5 py-1 text-xs font-medium text-[#2a55cc]">
                聊天筛选：{state.appliedSource}
              </span>
            )}
          </h2>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
          {sourceSummary.llmConfigured ? "LLM 已接入" : "演示模式"}
          {state.generatedAt && <span>· 最新 {formatDateTime(state.generatedAt)}</span>}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard title="数据条目" value={String(sourceSummary.totalItems)} delta="+12.5%" up icon="📡" />
        <KpiCard title="活跃数据源" value={String(sourceSummary.liveSources)} delta="+8.2%" up icon="🛰️" />
        <KpiCard title="趋势信号" value={String(trends.length)} delta="+15.8%" up icon="📈" />
        <DateCard day={day} month={month} weekday={weekday} themes={topThemes} />
      </div>

      {/* trend chart + briefing */}
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <TrendChart trends={trends} items={state.items ?? []} />
        <BriefingPanel sections={briefing} />
      </div>
    </section>
  );
}

/* ── KPI card ─────────────────────────────────────────────────────── */

function KpiCard({ title, value, delta, up, icon }: { title: string; value: string; delta: string; up: boolean; icon: string }) {
  return (
    <div className="rounded-2xl border border-[#ebeef3] bg-white p-4 shadow-[0_10px_24px_rgba(28,42,71,0.05)]">
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

/* ── today's date card ────────────────────────────────────────────── */

function DateCard({ day, month, weekday, themes }: { day: number; month: number; weekday: string; themes: string }) {
  return (
    <div className="rounded-2xl border border-[#d8e3ff] bg-[linear-gradient(180deg,#ffffff_0%,#f3f7ff_100%)] p-4 shadow-[0_10px_24px_rgba(61,116,255,0.08)]">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold leading-none text-[#3d74ff]">{day}</span>
        <span className="text-sm font-medium text-slate-600">{month} 月 · {weekday}</span>
      </div>
      <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">今日主题：{themes}</div>
    </div>
  );
}

/* ── trend spark chart ────────────────────────────────────────────── */

function TrendChart({ trends, items }: { trends: TrendSignal[]; items: IntelItem[] }) {
  const maxCount = Math.max(1, ...trends.map((t) => t.count));

  // Derive source breakdown from items (top 5 by article count).
  const sourceCounts = (() => {
    const m = new Map<string, number>();
    for (const item of items) {
      m.set(item.sourceName, (m.get(item.sourceName) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  })();
  const maxSrc = Math.max(1, ...sourceCounts.map(([, n]) => n));
  const total = sourceCounts.reduce((s, [, n]) => s + n, 0) || 1;

  return (
    <div className="rounded-2xl border border-[#ebeef3] bg-white p-5 shadow-[0_10px_24px_rgba(28,42,71,0.05)]">
      {/* trend bars */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-900">主题趋势</h3>
        <p className="text-xs text-slate-400">当前数据集中的信号强度</p>
      </div>
      {trends.length === 0 ? (
        <div className="flex h-28 items-center justify-center text-sm text-slate-400">暂无趋势数据</div>
      ) : (
        <div className="space-y-3">
          {trends.slice(0, 6).map((t) => (
            <div key={t.label} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-xs text-slate-600">{t.label}</span>
              <div className="flex-1 overflow-hidden rounded-full bg-[#f1f5f9]">
                <div className="h-2 rounded-full bg-[#3d74ff] transition-all" style={{ width: `${Math.round((t.count / maxCount) * 100)}%` }} />
              </div>
              <span className={`w-10 text-right text-xs font-medium ${t.stance === "up" ? "text-[#15803d]" : "text-slate-400"}`}>{t.count}</span>
              <span className="w-12 text-right text-xs text-slate-400">{t.delta}</span>
            </div>
          ))}
        </div>
      )}

      {/* source breakdown — fills the empty space below the trend bars */}
      {sourceCounts.length > 0 && (
        <div className="mt-5 border-t border-[#f1f3f6] pt-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">来源分布</span>
            <span className="text-[10px] text-slate-300">{total} 条</span>
          </div>
          <div className="space-y-2.5">
            {sourceCounts.map(([name, count]) => {
              const pct = Math.round((count / total) * 100);
              return (
                <div key={name} className="flex items-center gap-2.5">
                  <span className="w-24 shrink-0 truncate text-xs text-slate-600">{name}</span>
                  <div className="flex-1 overflow-hidden rounded-full bg-[#f1f5f9]">
                    <div
                      className="h-1.5 rounded-full bg-[#93b4f0] transition-all"
                      style={{ width: `${Math.round((count / maxSrc) * 100)}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-[11px] text-slate-400">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── briefing panel ───────────────────────────────────────────────── */

function BriefingPanel({ sections }: { sections: Array<{ heading: string; body: string }> }) {
  return (
    <div className="rounded-2xl border border-[#ebeef3] bg-white p-5 shadow-[0_10px_24px_rgba(28,42,71,0.05)]">
      <h3 className="mb-4 text-sm font-semibold text-slate-900">情报简报</h3>
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
