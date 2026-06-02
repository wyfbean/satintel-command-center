"use client";

import { SiteNav } from "@/components/site-nav";
import { RssManager } from "@/components/dashboard/rss-manager";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ChatPanel } from "@/components/dashboard/chat-panel";
import { FeedCard, cardGradient } from "@/components/dashboard/feed-card";
import { frontendMockDashboardData } from "@/lib/mock/frontend-dashboard";
import type { BriefingSection, DashboardData } from "@/types/intel";

/* ── small utils ───────────────────────────────────────────────────── */

function RssIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" fill="currentColor" />
    </svg>
  );
}

function formatDateTime(isoString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoString)); // "MM/DD HH:mm"
}

/** Full date+time for the article detail panel. */
function formatFullDate(isoString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoString));
}

function todayParts() {
  const now = new Date();
  const day = now.getDate();
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const weekday = weekdays[now.getDay()];
  const month = now.getMonth() + 1;
  return { day, month, weekday };
}

/* ── category strip ─────────────────────────────────────────────────── */

type Category = { key: string; label: string; dim: "all" | "tag" | "source" | "region"; value?: string };

const PAGE_SIZE = 24;

/* ── types ─────────────────────────────────────────────────────────── */

type DashboardShellProps = { initialData: DashboardData };
const useFrontendMock = process.env.NEXT_PUBLIC_FEED_MODE === "mock";

/* ── main component ─────────────────────────────────────────────────── */

export function DashboardShell({ initialData }: DashboardShellProps) {
  const bootData = useFrontendMock ? frontendMockDashboardData : initialData;
  const [data, setData] = useState(bootData);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCatKey, setActiveCatKey] = useState("all");
  const [query, setQuery] = useState("");
  const [briefing, setBriefing] = useState<BriefingSection[]>(bootData.briefing);
  const [isPending, startTransition] = useTransition();
  const [rssOpen, setRssOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  /** Columns combine tags + sources + regions into one selectable strip. */
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
      if (activeCat.dim === "tag" && !item.tags.includes(activeCat.value!)) return false;
      if (activeCat.dim === "source" && item.sourceName !== activeCat.value) return false;
      if (activeCat.dim === "region" && item.region !== activeCat.value) return false;
      if (q.length > 0 && !`${item.title} ${item.summary} ${item.tags.join(" ")}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // Browse-style portal feed: rank by composite score, not strict recency.
    return [...filtered].sort((a, b) => b.compositeScore - a.compositeScore);
  }, [data.items, query, activeCat]);

  const selectedItem = selectedId ? filteredItems.find((i) => i.id === selectedId) ?? null : null;
  const { day, month, weekday } = todayParts();

  /** Reset pagination to the first page; call from any handler that changes the
   *  filtered set (avoids a setState-in-effect cascade). */
  const resetPaging = () => setVisibleCount(PAGE_SIZE);

  /* incremental rendering: reveal more cards as a sentinel scrolls into view.
   * Re-created when the result count changes so the closure sees the new total. */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const total = filteredItems.length;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setVisibleCount((c) => (c < total ? c + PAGE_SIZE : c));
      }
    }, { rootMargin: "600px 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, [total]);

  const visibleItems = filteredItems.slice(0, visibleCount);

  async function refreshFeed() {
    resetPaging();
    if (useFrontendMock) {
      setData(frontendMockDashboardData);
      setBriefing(frontendMockDashboardData.briefing);
      setSelectedId(null);
      return;
    }
    // Trigger a background crawl cycle first so we get the freshest data,
    // then reload the feed. Both run to completion before the UI updates.
    await fetch("/api/crawl/trigger", { method: "POST" }).catch(() => {});
    const r = await fetch("/api/feed");
    const d = (await r.json()) as DashboardData;
    setData(d); setBriefing(d.briefing); setSelectedId(null);
  }

  async function refreshBriefing() {
    if (useFrontendMock) { setBriefing(frontendMockDashboardData.briefing); return; }
    const r = await fetch("/api/briefing");
    const p = (await r.json()) as { briefing: BriefingSection[] };
    setBriefing(p.briefing);
  }

  const detailGradient = selectedItem ? cardGradient(selectedItem.tags[0] ?? selectedItem.sourceName) : "";

  /* ── render ──────────────────────────────────────────────────────── */

  return (
    <main className="panel-grid min-h-screen px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-6">

        {/* ── floating pill nav ── */}
        <header>
          <div className="mx-auto flex w-full max-w-[980px] items-center justify-between rounded-full border border-[#d0d8e8] bg-white px-5 py-4 shadow-[0_14px_36px_rgba(28,42,71,0.10)]">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1a1f2e] text-sm font-semibold text-white">
                轨道
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">卫星情报资讯流</div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
                    {formatDateTime(data.generatedAt)}
                  </span>
                  <span>·</span>
                  <span>{data.sourceSummary.totalItems} 条</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <SiteNav />
              <button
                type="button"
                onClick={() => setRssOpen(true)}
                className="flex items-center gap-1.5 rounded-full border border-[#c8d0e0] bg-[#f4f7ff] px-3 py-2 text-xs font-medium text-[#2a55cc] hover:bg-[#e8f0ff] hover:border-[#3d74ff] transition"
              >
                <RssIcon />
                RSS
              </button>
            </div>
          </div>
        </header>

        <RssManager open={rssOpen} onClose={() => setRssOpen(false)} onChanged={() => void refreshFeed()} />

        {/* ── category strip (栏目) ── */}
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
                    active
                      ? "bg-[#1a1f2e] font-medium text-white"
                      : "text-slate-500 hover:bg-[#f4f7ff] hover:text-[#1f5eff]"
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* ── feed (left grid) + detail/default panel (right) ── */}
        <section className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">

          {/* left: image+title card grid */}
          <section className="min-w-0">
            <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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
                  onClick={() => startTransition(() => void refreshFeed())}
                  className="shrink-0 rounded-full border border-[#e8ebf0] bg-white px-4 py-2.5 text-sm text-slate-700 hover:bg-[#f8fafc] transition"
                >
                  {isPending ? "刷新中..." : "刷新订阅流"}
                </button>
              </div>
            </div>

            {filteredItems.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-[#d9deea] p-12 text-center text-sm text-slate-400">
                没有匹配当前栏目或搜索条件的资讯。
              </div>
            ) : (
              <>
                <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
                  {visibleItems.map((item) => (
                    <FeedCard
                      key={item.id}
                      item={item}
                      active={item.id === selectedItem?.id}
                      onSelect={() => setSelectedId(item.id)}
                    />
                  ))}
                </div>
                <div ref={sentinelRef} className="h-10" />
              </>
            )}
          </section>

          {/* right: detail when selected, otherwise today's date + theme + briefing */}
          <aside className="space-y-5 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-2 scrollbar-thin">
            {selectedItem ? (
              <>
                <section className="overflow-hidden rounded-[28px] border border-[#ebedf2] bg-white shadow-[0_12px_28px_rgba(28,42,71,0.06)]">
                  <div className="relative aspect-[16/9] w-full overflow-hidden">
                    {selectedItem.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={selectedItem.image} alt={selectedItem.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${detailGradient}`}>
                        <span className="px-4 text-center text-lg font-semibold text-white/90">
                          {selectedItem.tags[0] ?? selectedItem.sourceName}
                        </span>
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
                    <div className="mt-4 rounded-[22px] bg-[#f7f9ff] px-4 py-4">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">AI 摘要</div>
                      <p className="mt-2 text-sm leading-7 text-slate-700">{selectedItem.summary}</p>
                    </div>
                    <div className="mt-4 rounded-[22px] bg-[#fafbfc] px-4 py-4">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">原文摘要</div>
                      <p className="mt-2 text-sm leading-7 text-slate-600">{selectedItem.excerpt}</p>
                    </div>
                    <div className="mt-4 rounded-[22px] bg-[#fbfbfc] px-4 py-4">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">为什么值得看</div>
                      <p className="mt-2 text-sm leading-7 text-slate-600">{selectedItem.whyItMatters}</p>
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                      <a
                        href={selectedItem.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-full bg-[#1f2430] px-4 py-2 text-sm font-medium text-white"
                      >
                        打开原文
                      </a>
                      <button
                        type="button"
                        onClick={() => setSelectedId(null)}
                        className="rounded-full border border-[#e8ebf0] px-4 py-2 text-sm text-slate-500 hover:bg-[#f8fafc] transition"
                      >
                        返回今日
                      </button>
                    </div>
                  </div>
                </section>

                <ChatPanel selectedItems={[selectedItem]} />
              </>
            ) : (
              <>
                {/* today's date */}
                <section className="rounded-[28px] border border-[#d8e3ff] bg-[linear-gradient(180deg,#ffffff_0%,#f3f7ff_100%)] p-6 shadow-[0_18px_36px_rgba(61,116,255,0.08)]">
                  <div className="text-xs font-medium uppercase tracking-[0.24em] text-[#3d74ff]">今日</div>
                  <div className="mt-3 text-[64px] font-semibold leading-none text-[#3d74ff]">{day}</div>
                  <div className="mt-2 text-xl font-semibold text-slate-900">{month} 月 · {weekday}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
                      最新 {formatDateTime(data.generatedAt)}
                    </span>
                    <span>共 {data.sourceSummary.totalItems} 条</span>
                  </div>
                  <div className="mt-5 rounded-[20px] bg-[#111827] px-5 py-4 text-white">
                    <div className="text-xs font-medium text-white/60">今日主题</div>
                    <div className="mt-2 text-base font-semibold leading-7">
                      {data.trends.slice(0, 3).map((t) => t.label).join("、") || "高频成像、政务采购、星座部署"}
                    </div>
                  </div>
                </section>

                {/* today's AI briefing */}
                <section className="rounded-[28px] border border-[#ebedf2] bg-white p-6 shadow-[0_12px_28px_rgba(28,42,71,0.06)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">今日 AI 速览</div>
                      <h3 className="mt-1.5 text-lg font-semibold text-slate-900">聚合摘要</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => startTransition(() => void refreshBriefing())}
                      className="shrink-0 rounded-full border border-[#e8ebf0] px-3 py-1.5 text-xs text-slate-600 hover:bg-[#f8fafc] transition"
                    >
                      重新生成
                    </button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {briefing.length > 0 ? (
                      briefing.map((section) => (
                        <div key={section.heading} className="rounded-[18px] bg-[#f7f9ff] px-4 py-4">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#3d74ff]">
                            {section.heading}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{section.body}</p>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[18px] bg-[#f7f9ff] px-4 py-6 text-center text-sm text-slate-400">
                        正在生成 AI 速览……
                      </div>
                    )}
                  </div>
                  <div className="mt-4 text-center text-xs text-slate-400">点击左侧任意资讯卡片，查看 AI 摘要并追问</div>
                </section>

                {/* high-frequency topics */}
                <section className="rounded-[28px] border border-[#ebedf2] bg-white p-6 shadow-[0_12px_28px_rgba(28,42,71,0.06)]">
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">高频主题</div>
                  <div className="mt-4 space-y-3">
                    {data.trends.slice(0, 6).map((trend) => (
                      <button
                        key={trend.label}
                        type="button"
                        onClick={() => { setActiveCatKey(`tag:${trend.label}`); resetPaging(); }}
                        className="flex w-full items-center justify-between text-sm"
                      >
                        <span className="text-slate-700 hover:text-[#1f5eff] transition">{trend.label}</span>
                        <span className="rounded-full bg-[#f3f6ff] px-2.5 py-1 text-xs text-[#3d74ff]">{trend.count}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}
          </aside>
        </section>

      </div>
    </main>
  );
}
