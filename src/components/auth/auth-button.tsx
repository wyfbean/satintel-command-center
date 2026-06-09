"use client";

import { useState, useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";

type PrefChip   = { featureType: string; featureValue: string; weight: number };
type HistoryItem = {
  articleId:  string;
  eventType:  string;
  createdAt:  number;
  title:      string;
  titleZh:    string;
  sourceName: string;
  url:        string;
};

type ActivePanel = "history" | "interests" | "settings" | null;

type Props = { userId: string | null; userName?: string | null };

/* ── main export ──────────────────────────────────────────────────── */

export function AuthButton({ userId, userName }: Props) {
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  if (!userId) {
    return (
      <Link
        href="/signin"
        className="flex items-center gap-1.5 rounded-full border border-[#c8d0e0] bg-white px-3 py-2 text-xs font-medium text-[#1a2540] hover:border-[#3d74ff] hover:text-[#2a55cc] hover:bg-[#f4f7ff] transition"
      >
        登录
      </Link>
    );
  }

  const display = userName
    ? userName.length > 10 ? userName.slice(0, 10) + "…" : userName
    : "我的账号";

  const openPanel = (panel: ActivePanel) => { setActivePanel(panel); setMenuOpen(false); };

  return (
    <div className="relative" ref={menuRef}>
      {/* ── trigger ── */}
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border border-[#c8d0e0] bg-[#f4f7ff] px-3 py-2 text-xs font-medium text-[#2a55cc] hover:bg-[#e8f0ff] hover:border-[#3d74ff] transition"
      >
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1a2540] text-[10px] font-bold text-white">
          {display[0]?.toUpperCase() ?? "U"}
        </span>
        {display}
        <span className="text-[#93b4f0] text-[10px]">{menuOpen ? "▲" : "▼"}</span>
      </button>

      {/* ── dropdown ── */}
      {menuOpen && (
        <div className="absolute right-0 top-full z-40 mt-2 w-48 overflow-hidden rounded-2xl border border-[#e8ebf0] bg-white py-1.5 shadow-[0_12px_32px_rgba(28,42,71,0.14)]">
          {(
            [
              { key: "history",   icon: "🕐", label: "浏览历史" },
              { key: "interests", icon: "⚡", label: "我的偏好" },
              { key: "settings",  icon: "⚙️", label: "账号设置" },
            ] as { key: ActivePanel; icon: string; label: string }[]
          ).map(({ key, icon, label }) => (
            <button
              key={String(key)}
              type="button"
              onClick={() => openPanel(key)}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-[#f4f7ff] hover:text-[#2a55cc] transition"
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </button>
          ))}
          <div className="mx-3 my-1 h-px bg-[#f0f2f7]" />
          <button
            type="button"
            onClick={() => { void signOut({ callbackUrl: "/news" }); }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition"
          >
            <span className="text-base leading-none">↩</span>
            退出登录
          </button>
        </div>
      )}

      {/* ── panel overlay ── */}
      {activePanel && (
        <UserPanel panel={activePanel} onClose={() => setActivePanel(null)} />
      )}
    </div>
  );
}

/* ── panel overlay (same drawer pattern as RssManager) ───────────── */

const PANEL_TITLES: Record<string, string> = {
  history:   "浏览历史",
  interests: "我的偏好",
  settings:  "账号设置",
};

function UserPanel({ panel, onClose }: { panel: NonNullable<ActivePanel>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e8ebf0] px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{PANEL_TITLES[panel]}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-[#f4f5f7] hover:text-slate-700 transition"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {panel === "history"   && <HistoryPanel />}
          {panel === "interests" && <InterestsPanel />}
          {panel === "settings"  && <SettingsPanel onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

/* ── history panel ────────────────────────────────────────────────── */

function HistoryPanel() {
  const [items,   setItems]   = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/recommend/history")
      .then((r) => r.json())
      .then((d: HistoryItem[]) => setItems(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Empty text="加载中…" />;
  if (!items.length)
    return <Empty text="暂无浏览历史。点击资讯卡片后记录会出现在这里。" />;

  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <a
          key={item.articleId}
          href={item.url || "#"}
          target="_blank"
          rel="noreferrer"
          className="block rounded-xl border border-[#ebeef3] p-3 hover:border-[#b0c4ff] hover:bg-[#f8faff] transition"
        >
          <div className="line-clamp-2 text-xs font-medium text-slate-800 leading-5">
            {item.titleZh || item.title || item.articleId}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-400">
            {item.sourceName && <span>{item.sourceName}</span>}
            {item.sourceName && <span>·</span>}
            <span>
              {new Intl.DateTimeFormat("zh-CN", {
                month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit", hour12: false,
              }).format(new Date(item.createdAt))}
            </span>
            {item.eventType === "dwell" && (
              <span className="rounded-full bg-[#f0fdf4] px-1.5 py-0.5 text-[#15803d]">精读</span>
            )}
          </div>
        </a>
      ))}
    </div>
  );
}

/* ── interests panel ──────────────────────────────────────────────── */

const TYPE_LABEL: Record<string, string> = {
  tag:       "话题标签",
  region:    "地区关注",
  source:    "常看来源",
  satellite: "相关卫星",
};

function InterestsPanel() {
  const [prefs,   setPrefs]   = useState<PrefChip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/recommend/prefs")
      .then((r) => r.json())
      .then((d: PrefChip[]) => setPrefs(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Empty text="加载中…" />;
  if (!prefs.length)
    return <Empty text="暂无偏好记录。继续阅读资讯后，兴趣标签会自动积累在这里。" />;

  const grouped = prefs.reduce<Record<string, PrefChip[]>>((acc, p) => {
    (acc[p.featureType] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([type, chips]) => (
        <div key={type}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {TYPE_LABEL[type] ?? type}
          </div>
          <div className="flex flex-wrap gap-2">
            {chips.map((p) => (
              <span
                key={`${p.featureType}:${p.featureValue}`}
                className="rounded-full border border-[#dbe4ff] bg-[#f4f7ff] px-3 py-1 text-xs text-[#2a55cc]"
              >
                {p.featureValue}
                <span className="ml-1.5 text-[#93b4f0]">{p.weight.toFixed(1)}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── settings panel ───────────────────────────────────────────────── */

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [busy,    setBusy]    = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function clearHistory() {
    setBusy(true);
    await fetch("/api/recommend/history", { method: "DELETE" }).catch(() => {});
    setMessage("浏览历史已清空");
    setBusy(false);
  }

  async function clearAll() {
    setBusy(true);
    await fetch("/api/recommend/prefs", { method: "DELETE" }).catch(() => {});
    setMessage("偏好与浏览历史已全部清除，推荐将恢复默认排序");
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-xl bg-[#f0fdf4] px-4 py-2.5 text-sm text-[#15803d]">
          {message}
        </div>
      )}

      <SettingRow
        label="清空浏览历史"
        desc="删除所有点击记录，偏好权重不受影响"
        action="清空"
        danger
        busy={busy}
        onClick={() => void clearHistory()}
      />

      <SettingRow
        label="重置所有推荐偏好"
        desc="清除全部偏好标签与浏览历史，推荐将恢复默认排序"
        action="重置"
        danger
        busy={busy}
        onClick={() => void clearAll()}
      />

      <div className="border-t border-[#f0f2f7] pt-4">
        <button
          type="button"
          onClick={() => { onClose(); void signOut({ callbackUrl: "/news" }); }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-100 transition"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}

function SettingRow({
  label, desc, action, danger, busy, onClick,
}: {
  label: string; desc: string; action: string; danger?: boolean; busy?: boolean; onClick: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-[#ebeef3] p-4">
      <div>
        <div className="text-sm font-medium text-slate-800">{label}</div>
        <div className="mt-0.5 text-xs leading-5 text-slate-400">{desc}</div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
          danger
            ? "bg-red-50 text-red-600 hover:bg-red-100"
            : "bg-[#f4f7ff] text-[#2a55cc] hover:bg-[#e8f0ff]"
        }`}
      >
        {busy ? "…" : action}
      </button>
    </div>
  );
}

/* ── shared ───────────────────────────────────────────────────────── */

function Empty({ text }: { text: string }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center text-center text-sm text-slate-400">
      {text}
    </div>
  );
}
