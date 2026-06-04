"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { FeedCard, cardGradient } from "@/components/dashboard/feed-card";
import type { DashboardData, IntelItem } from "@/types/intel";

/* ── anonymous session ID ─────────────────────────────────────────── */

/** Returns a stable UUID for this browser (persisted in localStorage). */
function getSessionId(): string {
  if (typeof window === "undefined") return "";
  const KEY = "satintel_sid";
  const existing = localStorage.getItem(KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(KEY, id);
  return id;
}

/** Fire-and-forget: POST a click event to the recommendation API. */
function trackClick(articleId: string): void {
  const sid = getSessionId();
  if (!sid) return;
  fetch("/api/recommend/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ articleId, sid }),
  }).catch(() => {}); // never block the UI
}

/**
 * 下沉式资讯流（合并首页的下半部分）。
 *
 * 数据用服务端全量 `data.items`（智能体 STATE_SNAPSHOT 只携带前 12 条，不足以
 * 撑满资讯流，故这里直接吃服务端全量；与 hero 同源于一次 getDashboardData）。
 * `activeSource` 由聊天里的 filterBySource 前端动作受控传入，实现「对话驱动筛选」。
 */

function formatFullDate(isoString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(isoString));
}

type Category = { key: string; label: string; dim: "all" | "tag" | "source" | "region"; value?: string };
const PAGE_SIZE = 24;

type NewsFeedProps = {
  data: DashboardData;
  activeSource: string | null;
  onClearSource: () => void;
  onSelect: (item: IntelItem | null) => void;
  onRefresh: () => void | Promise<void>;
  isRefreshing?: boolean;
};

export function NewsFeed({ data, activeSource, onClearSource, onSelect, onRefresh, isRefreshing }: NewsFeedProps) {
  const [activeCatKey, setActiveCatKey] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const resetPaging = () => setVisibleCount(PAGE_SIZE);

  const categories = useMemo<Category[]>(() => {
    const cats: Category[] = [{ key: "all", label: "全部", dim: "all" }];
    for (const t of data.filters.tags) cats.push({ key: `tag:${t}`, label: t, dim: "tag", value: t });
    for (const s of data.filters.sources) cats.push({ key: `source:${s}`, label: s, dim: "source", value: s });
    for (const r of data.filters.regions ?? []) cats.push({ key: `region:${r}`, label: r, dim: "region", value: r });
    return cats;
  }, [data.filters]);

  const activeCat = categories.find((c) => c.key === activeCatKey) ?? categories[0];

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = data.items.filter((item) => {
      if (activeSource && item.sourceName !== activeSource) return false;
      if (activeCat.dim === "tag" && !item.tags.includes(activeCat.value!)) return false;
      if (activeCat.dim === "source" && item.sourceName !== activeCat.value) return false;
      if (activeCat.dim === "region" && item.region !== activeCat.value) return false;
      if (q.length > 0 && !`${item.title} ${item.summary} ${item.tags.join(" ")}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return [...filtered].sort((a, b) => b.compositeScore - a.compositeScore);
  }, [data.items, query, activeCat, activeSource]);

  const selectedItem = selectedId ? filteredItems.find((i) => i.id === selectedId) ?? null : null;
  const detailGradient = selectedItem ? cardGradient(selectedItem.tags[0] ?? selectedItem.sourceName) : "";

  /* incremental rendering: reveal more cards as the sentinel scrolls into view. */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const total = filteredItems.length;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisibleCount((c) => (c < total ? c + PAGE_SIZE : c));
    }, { rootMargin: "600px 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, [total]);

  const visibleItems = filteredItems.slice(0, visibleCount);

  function select(item: IntelItem | null) {
    setSelectedId(item?.id ?? null);
    onSelect(item);
    // Record the click for personalised re-ranking on the next feed load.
    if (item) trackClick(item.id);
  }

  return (
    <section className="space-y-5">
      {/* category strip */}
      <nav className="rounded-full border border-[#ebedf2] bg-white px-3 py-2 shadow-[0_8px_24px_rgba(28,42,71,0.05)]">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
          {categories.map((cat) => {
            const active = cat.key === activeCat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => { setActiveCatKey(cat.key); resetPaging(); }}
                className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm transition ${
                  active ? "bg-[#1a1f2e] font-medium text-white" : "text-slate-500 hover:bg-[#f4f7ff] hover:text-[#1f5eff]"
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* AI 来源筛选提示 */}
      {activeSource && (
        <div className="flex items-center gap-2 rounded-full bg-[#eef4ff] px-4 py-2 text-xs text-[#2a55cc]">
          <span>AI 已按来源筛选：<b>{activeSource}</b></span>
          <button type="button" onClick={onClearSource} className="ml-auto rounded-full bg-white px-2.5 py-1 text-[#2a55cc] hover:bg-[#dbe8ff] transition">
            清除筛选 ✕
          </button>
        </div>
      )}

      {/* header + search */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">资讯流</div>
          <h2 className="mt-1.5 text-2xl font-semibold text-slate-900">
            {activeCat.dim === "all" ? "全部资讯" : activeCat.label}
            <span className="ml-2 text-base font-normal text-slate-400">{filteredItems.length} 条</span>
          </h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); resetPaging(); }}
            placeholder="搜索标题、主题或摘要"
            className="w-full rounded-full border border-[#e8ebf0] bg-white px-4 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 lg:w-64"
          />
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="shrink-0 rounded-full border border-[#e8ebf0] bg-white px-4 py-2.5 text-sm text-slate-700 hover:bg-[#f8fafc] transition"
          >
            {isRefreshing ? "刷新中..." : "刷新订阅流"}
          </button>
        </div>
      </div>

      {/* feed grid + detail */}
      <div className={selectedItem ? "grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_380px]" : ""}>
        <div className="min-w-0">
          {filteredItems.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-[#d9deea] p-12 text-center text-sm text-slate-400">
              没有匹配当前栏目或搜索条件的资讯。
            </div>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
                {visibleItems.map((item) => (
                  <FeedCard key={item.id} item={item} active={item.id === selectedItem?.id} onSelect={() => select(item)} />
                ))}
              </div>
              <div ref={sentinelRef} className="h-10" />
            </>
          )}
        </div>

        {selectedItem && (
          <aside className="space-y-5 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-2 scrollbar-thin">
            <section className="overflow-hidden rounded-[28px] border border-[#ebedf2] bg-white shadow-[0_12px_28px_rgba(28,42,71,0.06)]">
              <div className="relative aspect-[16/9] w-full overflow-hidden">
                {selectedItem.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selectedItem.image} alt={selectedItem.title} className="h-full w-full object-cover" />
                ) : (
                  <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${detailGradient}`}>
                    <span className="px-4 text-center text-lg font-semibold text-white/90">{selectedItem.tags[0] ?? selectedItem.sourceName}</span>
                  </div>
                )}
              </div>
              <div className="p-5">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">AI 摘要</div>
                <h2 className="mt-2 text-2xl font-semibold leading-snug text-slate-900">{selectedItem.title}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span>{selectedItem.sourceName}</span>
                  <span>{formatFullDate(selectedItem.publishedAt)}</span>
                </div>
                <div className="mt-4 space-y-2.5 text-sm leading-7 text-slate-600">
                  <p>{selectedItem.summary}</p>
                  {selectedItem.whyItMatters &&
                   selectedItem.whyItMatters !== selectedItem.summary && (
                    <p>{selectedItem.whyItMatters}</p>
                  )}
                </div>
                <div className="mt-4 rounded-[18px] bg-[#eef4ff] px-4 py-3 text-xs leading-5 text-[#2a55cc]">
                  💬 点击右下角 AI 气泡，可基于本文向智能体追问。
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <a href={selectedItem.url} target="_blank" rel="noreferrer" className="inline-flex rounded-full bg-[#1f2430] px-4 py-2 text-sm font-medium text-white">打开原文</a>
                  <button type="button" onClick={() => select(null)} className="rounded-full border border-[#e8ebf0] px-4 py-2 text-sm text-slate-500 hover:bg-[#f8fafc] transition">关闭</button>
                </div>
              </div>
            </section>
          </aside>
        )}
      </div>
    </section>
  );
}
