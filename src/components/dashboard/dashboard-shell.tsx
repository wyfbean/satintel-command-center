"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ChatPanel } from "@/components/dashboard/chat-panel";
import { FeedCard } from "@/components/dashboard/feed-card";
import { frontendMockDashboardData } from "@/lib/mock/frontend-dashboard";
import type { BriefingSection, DashboardData } from "@/types/intel";

function formatDateTime(isoString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoString));
}

type DashboardShellProps = {
  initialData: DashboardData;
};

const useFrontendMock = process.env.NEXT_PUBLIC_FEED_MODE === "mock";

export function DashboardShell({ initialData }: DashboardShellProps) {
  const bootData = useFrontendMock ? frontendMockDashboardData : initialData;
  const [data, setData] = useState(bootData);
  const [selectedId, setSelectedId] = useState(bootData.items[0]?.id ?? "");
  const [sourceFilter, setSourceFilter] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const [briefing, setBriefing] = useState<BriefingSection[]>(bootData.briefing);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isPending, startTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);
  const feedNodeMap = useRef(new Map<string, HTMLElement>());
  const scrollFrameRef = useRef<number | null>(null);

  const filteredItems = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return data.items.filter((item) => {
      const matchesSource = sourceFilter === "全部" || item.sourceName === sourceFilter;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        `${item.title} ${item.summary} ${item.tags.join(" ")}`.toLowerCase().includes(normalizedQuery);

      return matchesSource && matchesQuery;
    });
  }, [data.items, deferredQuery, sourceFilter]);

  const selectedItem = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? data.items[0];
  const activeIndex = Math.max(
    0,
    filteredItems.findIndex((item) => item.id === selectedItem?.id),
  );
  const visibleDateLabels = ["现在", data.dateTitle.slice(5), "5.22", "5.21", "5.20"];

  useEffect(() => {
    const handleScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const nextProgress = scrollable <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / scrollable));
      const viewportAnchor = Math.min(window.innerHeight * 0.38, 280);
      const nearest = filteredItems
        .map((item) => {
          const node = feedNodeMap.current.get(item.id);
          const rect = node?.getBoundingClientRect();

          return {
            id: item.id,
            distance: rect ? Math.abs(rect.top - viewportAnchor) : Number.POSITIVE_INFINITY,
          };
        })
        .sort((left, right) => left.distance - right.distance)[0];

      setScrollProgress(nextProgress);

      if (nearest?.id) {
        setSelectedId((current) => (current === nearest.id ? current : nearest.id));
      }
    };
    const scheduleScrollUpdate = () => {
      if (scrollFrameRef.current !== null) {
        return;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        handleScroll();
      });
    };

    scheduleScrollUpdate();
    window.addEventListener("scroll", scheduleScrollUpdate, { passive: true });

    return () => {
      window.removeEventListener("scroll", scheduleScrollUpdate);

      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [filteredItems]);

  function registerFeedNode(id: string, node: HTMLElement | null) {
    if (node) {
      feedNodeMap.current.set(id, node);
      return;
    }

    feedNodeMap.current.delete(id);
  }

  function scrollToItem(id: string) {
    setSelectedId(id);
    feedNodeMap.current.get(id)?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }

  async function refreshFeed() {
    if (useFrontendMock) {
      setData(frontendMockDashboardData);
      setBriefing(frontendMockDashboardData.briefing);
      setSelectedId(frontendMockDashboardData.items[0]?.id ?? "");
      return;
    }

    const response = await fetch("/api/feed");
    const nextData = (await response.json()) as DashboardData;
    setData(nextData);
    setBriefing(nextData.briefing);
    setSelectedId(nextData.items[0]?.id ?? "");
  }

  async function refreshBriefing() {
    if (useFrontendMock) {
      setBriefing(frontendMockDashboardData.briefing);
      return;
    }

    const response = await fetch("/api/briefing");
    const payload = (await response.json()) as { briefing: BriefingSection[] };
    setBriefing(payload.briefing);
  }

  return (
    <main className="panel-grid min-h-screen px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-8">
        <header className="flex flex-col gap-6">
          <div className="mx-auto flex w-full max-w-[980px] items-center justify-between rounded-full border border-[#ebedf2] bg-white px-5 py-4 shadow-[0_14px_36px_rgba(28,42,71,0.08)]">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1f2430] text-sm font-semibold text-white">
                轨道
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">卫星情报资讯流</div>
                <div className="text-xs text-slate-400">Orbit Intelligence Feed</div>
              </div>
            </div>

            <nav className="hidden items-center gap-8 text-sm text-slate-500 lg:flex">
              <span className="font-medium text-slate-900">资讯流</span>
              <span>RSS 源</span>
              <span>AI 抓取</span>
              <span>Ask AI</span>
              <span>中文</span>
            </nav>

            <button className="rounded-full bg-[#111111] px-5 py-3 text-sm font-medium text-white">添加订阅源</button>
          </div>

          <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
            <aside className="rounded-[34px] border border-[#d8e3ff] bg-[linear-gradient(180deg,#ffffff_0%,#f3f7ff_100%)] p-6 shadow-[0_18px_36px_rgba(61,116,255,0.08)]">
              <div className="text-xs font-medium uppercase tracking-[0.24em] text-[#3d74ff]">日期索引</div>
              <div className="mt-6 text-[68px] font-semibold leading-none text-[#3d74ff]">23</div>
              <div className="mt-3 text-3xl font-semibold text-slate-900">5 月 星期六</div>
              <p className="mt-4 text-sm leading-7 text-slate-500">
                以时间线方式展示卫星、遥感、微信行业信号，支持 RSS 扩展与 AI 抓取补充。
              </p>
              <div className="mt-8 rounded-[28px] bg-[#111827] px-5 py-6 text-white">
                <div className="text-sm font-medium text-white/70">今日主轴</div>
                <div className="mt-3 text-2xl font-semibold leading-9">高频成像、政务采购、星座部署</div>
              </div>
            </aside>

            <section className="pt-2">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="status-dot live" />
                  <span className="rounded-full bg-[#eefbf1] px-3 py-1 text-sm text-[#15803d]">实时更新</span>
                  <span className="text-sm text-slate-400">最新编译于 {formatDateTime(data.generatedAt)}</span>
                </div>
                <div className="max-w-4xl">
                  <div className="text-sm font-medium text-slate-400">{data.hero.eyebrow}</div>
                  <h1 className="mt-3 text-5xl font-semibold tracking-tight text-slate-900 md:text-6xl">
                    {data.hero.title}
                  </h1>
                  <p className="mt-4 text-[17px] leading-8 text-slate-500">{data.hero.description}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  <span>已聚合 {data.sourceSummary.totalItems} 条资讯</span>
                  <span>活跃源 {data.sourceSummary.liveSources}</span>
                  <span>来源总数 {data.sourceSummary.totalSources}</span>
                  <span>{data.sourceSummary.llmConfigured ? "LLM 已接入" : "当前使用本地回退摘要"}</span>
                </div>
              </div>
            </section>

            <aside className="rounded-[28px] border border-[#ebedf2] bg-white p-5 shadow-[0_14px_34px_rgba(28,42,71,0.06)]">
              <div className="grid grid-cols-2 gap-2 rounded-full bg-[#f4f5f7] p-1 text-sm">
                <div className="rounded-full bg-white px-4 py-2 text-center font-medium text-slate-900 shadow-sm">
                  我是 Agent
                </div>
                <div className="rounded-full px-4 py-2 text-center text-slate-400">我是分析师</div>
              </div>
              <div className="mt-4 rounded-[22px] bg-[#f8f9fb] p-4">
                <div className="text-sm font-medium text-slate-700">发送给你的 Agent</div>
                <p className="mt-2 text-sm leading-7 text-slate-500">
                  让它自动读取源、做摘要，并对当前日期的信息流建立上下文。
                </p>
                <div className="mt-3 rounded-[18px] border border-[#e8ebf0] bg-white px-4 py-3 font-mono text-xs text-[#3d74ff]">
                  Read /feeds/SKILL.md · parse rss · summarize news · ask follow-up
                </div>
              </div>
            </aside>
          </section>
        </header>

        <section className="grid items-start gap-8 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <aside className="space-y-4 xl:sticky xl:top-6">
            <div className="rounded-[28px] border border-[#ebedf2] bg-white p-5">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">来源过滤</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {["全部", ...data.filters.sources].map((source) => (
                  <button
                    key={source}
                    type="button"
                    onClick={() => setSourceFilter(source)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      sourceFilter === source
                        ? "border-[#bfd0ff] bg-[#eef4ff] text-[#1f5eff]"
                        : "border-[#e8ebf0] bg-white text-slate-500"
                    }`}
                  >
                    {source}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-[#ebedf2] bg-white p-5">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">滑动索引</div>
              <div className="mt-4 flex items-start gap-4">
                <div className="relative h-48 w-px bg-[#e2e6ef]">
                  <div
                    className="absolute left-1/2 top-0 w-0.5 -translate-x-1/2 rounded-full bg-[#3d74ff] transition-all"
                    style={{ height: `${Math.max(6, scrollProgress * 100)}%` }}
                  />
                  <div
                    className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white bg-[#3d74ff] shadow-[0_0_0_4px_rgba(61,116,255,0.12)] transition-all"
                    style={{ top: `calc(${Math.min(1, scrollProgress) * 100}% - 6px)` }}
                  />
                </div>
                <div className="space-y-5">
                  {visibleDateLabels.map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        if (index === 0 || index === 1) {
                          scrollToItem(filteredItems[0]?.id ?? "");
                        }
                      }}
                      className={`block text-left font-mono ${
                        index < 2 ? "text-2xl font-semibold text-[#3d74ff]" : "text-lg text-slate-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-5 rounded-[18px] bg-[#f7f9ff] px-4 py-3 text-sm text-slate-500">
                当前第 {filteredItems.length ? activeIndex + 1 : 0} / {filteredItems.length} 条
              </div>
            </div>

            <div className="rounded-[28px] border border-[#ebedf2] bg-white p-5">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">高频主题</div>
              <div className="mt-4 space-y-3">
                {data.trends.slice(0, 5).map((trend) => (
                  <div key={trend.label} className="flex items-center justify-between text-sm">
                    <div className="text-slate-700">{trend.label}</div>
                    <div className="rounded-full bg-[#f3f6ff] px-2.5 py-1 text-xs text-[#3d74ff]">{trend.count}</div>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <section className="min-w-0">
            <div className="rounded-[32px] border border-[#ebedf2] bg-white p-6 shadow-[0_12px_30px_rgba(28,42,71,0.06)]">
              <div className="flex flex-col gap-4 border-b border-[#eff1f4] pb-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">资讯流瀑布</div>
                  <h2 className="mt-2 text-3xl font-semibold text-slate-900">按时间推进的信息流</h2>
                </div>
                <div className="flex flex-wrap gap-3">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索标题、主题或摘要"
                    className="w-full rounded-full border border-[#e8ebf0] bg-[#fafbfc] px-4 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 lg:w-72"
                  />
                  <button
                    type="button"
                    onClick={() => startTransition(() => void refreshFeed())}
                    className="rounded-full border border-[#e8ebf0] bg-white px-4 py-3 text-sm text-slate-700"
                  >
                    {isPending ? "刷新中..." : "刷新订阅流"}
                  </button>
                </div>
              </div>

              <div className="mt-6 space-y-6 pr-2">
                {filteredItems.map((item) => (
                  <FeedCard
                    key={item.id}
                    item={item}
                    active={item.id === selectedItem?.id}
                    onSelect={() => scrollToItem(item.id)}
                    registerNode={registerFeedNode}
                  />
                ))}
                {filteredItems.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-[#d9deea] p-8 text-center text-sm text-slate-400">
                    没有匹配当前筛选条件的资讯。
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <aside className="space-y-5 xl:sticky xl:top-6">
            <section className="rounded-[28px] border border-[#ebedf2] bg-white p-5 shadow-[0_12px_28px_rgba(28,42,71,0.06)]">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">AI 抓取摘要</div>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">{selectedItem?.title ?? "请选择一条新闻"}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>{selectedItem?.sourceName}</span>
                <span>{selectedItem ? formatDateTime(selectedItem.publishedAt) : ""}</span>
              </div>
              <div className="mt-4 rounded-[22px] bg-[#f7f9ff] px-4 py-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">AI 摘要</div>
                <p className="mt-2 text-sm leading-7 text-slate-700">{selectedItem?.summary}</p>
              </div>
              <div className="mt-4 rounded-[22px] bg-[#fafbfc] px-4 py-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">原文摘要</div>
                <p className="mt-2 text-sm leading-7 text-slate-600">{selectedItem?.excerpt}</p>
              </div>
              <div className="mt-4 rounded-[22px] bg-[#fbfbfc] px-4 py-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">为什么值得看</div>
                <p className="mt-2 text-sm leading-7 text-slate-600">{selectedItem?.whyItMatters}</p>
              </div>
              <a
                href={selectedItem?.url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex rounded-full bg-[#1f2430] px-4 py-2 text-sm font-medium text-white"
              >
                打开原文
              </a>
            </section>

            <section className="rounded-[28px] border border-[#ebedf2] bg-white p-5 shadow-[0_12px_28px_rgba(28,42,71,0.06)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">今日 AI 速览</div>
                  <h3 className="mt-2 text-2xl font-semibold text-slate-900">聚合摘要</h3>
                </div>
                <button
                  type="button"
                  onClick={() => startTransition(() => void refreshBriefing())}
                  className="rounded-full border border-[#e8ebf0] px-3 py-2 text-sm text-slate-600"
                >
                  重新生成
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {briefing.map((section) => (
                  <div key={section.heading} className="rounded-[22px] bg-[#fafbfc] px-4 py-4">
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">{section.heading}</div>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{section.body}</p>
                  </div>
                ))}
              </div>
            </section>

            <ChatPanel selectedItems={selectedItem ? [selectedItem] : filteredItems.slice(0, 1)} />
          </aside>
        </section>
      </div>
    </main>
  );
}
