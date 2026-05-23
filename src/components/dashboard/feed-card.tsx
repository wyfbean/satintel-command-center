"use client";

import type { IntelItem } from "@/types/intel";

function formatTime(isoString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoString));
}

function scoreTone(score: number) {
  if (score >= 0.75) return "text-[#1f5eff]";
  if (score >= 0.55) return "text-[#3d74ff]";
  return "text-slate-500";
}

type FeedCardProps = {
  item: IntelItem;
  active: boolean;
  onSelect: () => void;
};

export function FeedCard({ item, active, onSelect }: FeedCardProps) {
  return (
    <article className="grid grid-cols-[54px_1fr] gap-4">
      <div className="flex flex-col items-center">
        <div className="rounded-full border border-[#dfe7ff] bg-white px-2 py-1 text-[11px] font-medium text-[#3d74ff]">
          {item.timelineLabel}
        </div>
        <div className="mt-3 h-full w-px bg-[#e7e9ef]" />
      </div>

      <button
        type="button"
        onClick={onSelect}
        className={`w-full rounded-[28px] border bg-white p-5 text-left transition ${
          active
            ? "border-[#bfd0ff] shadow-[0_14px_34px_rgba(61,116,255,0.12)]"
            : "border-[#ebeef3] hover:border-[#d6def7]"
        }`}
      >
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span className="font-mono text-xs text-slate-400">{formatTime(item.publishedAt)}</span>
          <span>{item.sourceName}</span>
          <span className="rounded-full bg-[#f3f6ff] px-2.5 py-1 text-xs text-[#3d74ff]">{item.sourceLabel}</span>
          <span className={`ml-auto text-xs font-medium ${scoreTone(item.compositeScore)}`}>
            热度 {Math.round(item.compositeScore * 100)}
          </span>
        </div>

        <h3 className="mt-3 text-[28px] font-semibold leading-[1.35] text-slate-900">{item.title}</h3>
        <p className="mt-3 text-lg leading-8 text-slate-600">{item.excerpt}</p>

        <div className="mt-4 rounded-[22px] bg-[#f7f9ff] px-4 py-4">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">AI 摘要</div>
          <p className="mt-2 text-sm leading-7 text-slate-700">{item.summary}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {item.tags.slice(0, 4).map((tag) => (
            <span
              key={`${item.id}-${tag}`}
              className="rounded-full border border-[#e8ebf0] bg-[#fbfbfc] px-3 py-1 text-xs text-slate-500"
            >
              {tag}
            </span>
          ))}
        </div>
      </button>
    </article>
  );
}
