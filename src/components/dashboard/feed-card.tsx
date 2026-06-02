"use client";

import { useState } from "react";

import type { IntelItem } from "@/types/intel";

function formatTime(isoString: string) {
  const d = new Date(isoString);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const isThisYear = d.getFullYear() === now.getFullYear();

  if (isToday) {
    return (
      "今天 " +
      new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d)
    );
  }
  if (isThisYear) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: false,
    }).format(d);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** A small palette of gradient classes; a stable hash maps each seed to one
 *  so the same column/tag always renders the same placeholder colour. */
const GRADIENTS = [
  "from-[#3d74ff] to-[#22d3ee]",
  "from-[#6366f1] to-[#a855f7]",
  "from-[#0ea5e9] to-[#2563eb]",
  "from-[#f59e0b] to-[#ef4444]",
  "from-[#10b981] to-[#0891b2]",
  "from-[#8b5cf6] to-[#ec4899]",
  "from-[#1f2937] to-[#3b82f6]",
];

export function cardGradient(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

type FeedCardProps = {
  item: IntelItem;
  active: boolean;
  onSelect: () => void;
};

export function FeedCard({ item, active, onSelect }: FeedCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = Boolean(item.image) && !imgFailed;
  const gradient = cardGradient(item.tags[0] ?? item.sourceName ?? item.id);
  const placeholderLabel = item.tags[0] ?? item.sourceName;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`group flex h-full w-full flex-col overflow-hidden rounded-[22px] border bg-white text-left transition ${
        active
          ? "border-[#bfd0ff] shadow-[0_14px_34px_rgba(61,116,255,0.16)]"
          : "border-[#ebeef3] hover:border-[#d6def7] hover:shadow-[0_10px_24px_rgba(28,42,71,0.08)]"
      }`}
    >
      {/* image / gradient placeholder (16:9) */}
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image as string}
            alt={item.title}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${gradient}`}>
            <span className="px-3 text-center text-base font-semibold tracking-wide text-white/90">
              {placeholderLabel}
            </span>
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          {item.sourceLabel}
        </span>
      </div>

      {/* body */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 text-[17px] font-semibold leading-[1.4] text-slate-900">
          {item.title}
        </h3>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-xs text-slate-400">
          <span>{item.sourceName}</span>
          <span className="font-mono">{formatTime(item.publishedAt)}</span>
          <span className="ml-auto rounded-full bg-[#f3f6ff] px-2 py-0.5 font-medium text-[#3d74ff]">
            热度 {Math.round(item.compositeScore * 100)}
          </span>
        </div>
      </div>
    </button>
  );
}
