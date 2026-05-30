"use client";

import { useEffect, useRef, useState } from "react";

type FeedRow = {
  id: string;
  url: string;
  name: string;
  tags: string[];
  addedAt: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called after any add/delete so the parent can refresh feed data */
  onChanged: () => void;
};

export function RssManager({ open, onClose, onChanged }: Props) {
  const [feeds, setFeeds] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/rss")
      .then((r) => r.json())
      .then((data: FeedRow[]) => setFeeds(data))
      .catch(() => {})
      .finally(() => setLoading(false));
    setTimeout(() => urlRef.current?.focus(), 50);
  }, [open]);

  async function handleAdd() {
    setError("");
    if (!url.trim().startsWith("http")) { setError("URL 必须以 http:// 或 https:// 开头"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          name: name.trim() || url.trim(),
          tags: tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) { const d = await res.json() as { error?: string }; setError(d.error ?? "添加失败"); return; }
      const added = await res.json() as FeedRow;
      setFeeds((prev) => [added, ...prev]);
      setUrl(""); setName(""); setTags(""); setTestResult(null);
      onChanged();
    } catch {
      setError("网络错误，请重试。");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/rss/${id}`, { method: "DELETE" });
    setFeeds((prev) => prev.filter((f) => f.id !== id));
    onChanged();
  }

  async function handleTest() {
    if (!url.trim().startsWith("http")) { setError("请先输入有效的 RSS URL"); return; }
    setTesting(true); setTestResult(null); setError("");
    try {
      const res = await fetch("/api/rss/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const d = await res.json() as { count?: number; title?: string; error?: string };
      if (!res.ok || d.error) { setError(d.error ?? "无法解析该 RSS 源"); }
      else { setTestResult(`✓ 可访问，检测到 ${d.count ?? 0} 条条目，订阅名称：${d.title ?? "未知"}`); }
    } catch {
      setError("网络错误，无法访问该地址。");
    } finally {
      setTesting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* drawer */}
      <div className="relative ml-auto flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between border-b border-[#e8ebf0] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">RSS 订阅管理</h2>
            <p className="text-xs text-slate-400 mt-0.5">添加的订阅将持久化存储，立即生效</p>
          </div>
          <button type="button" onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-[#f4f5f7] hover:text-slate-700">✕</button>
        </div>

        {/* add form */}
        <div className="border-b border-[#e8ebf0] px-6 py-4">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">RSS / Atom URL *</label>
              <div className="flex gap-2">
                <input
                  ref={urlRef}
                  type="url"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setTestResult(null); }}
                  placeholder="https://example.com/feed.xml"
                  className="flex-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm outline-none focus:border-[#3d74ff] focus:ring-1 focus:ring-[#3d74ff]"
                  onKeyDown={(e) => { if (e.key === "Enter") void handleTest(); }}
                />
                <button type="button" onClick={() => void handleTest()} disabled={testing}
                  className="rounded-lg border border-[#e2e8f0] px-3 py-2 text-xs font-medium text-slate-600 hover:bg-[#f8fafc] disabled:opacity-50">
                  {testing ? "检测…" : "测试"}
                </button>
              </div>
              {testResult && <p className="mt-1 text-xs text-[#15803d]">{testResult}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">显示名称</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="我的订阅源"
                  className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm outline-none focus:border-[#3d74ff]" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">标签（逗号分隔）</label>
                <input type="text" value={tags} onChange={(e) => setTags(e.target.value)}
                  placeholder="卫星, 遥感"
                  className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm outline-none focus:border-[#3d74ff]" />
              </div>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button type="button" onClick={() => void handleAdd()} disabled={saving || !url.trim()}
              className="w-full rounded-lg bg-[#3d74ff] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2f62d9] disabled:opacity-50">
              {saving ? "添加中…" : "+ 添加订阅"}
            </button>
          </div>
        </div>

        {/* existing feeds */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">已配置订阅（{feeds.length}）</span>
            {loading && <span className="text-xs text-slate-400">加载中…</span>}
          </div>
          {feeds.length === 0 && !loading ? (
            <div className="rounded-xl bg-[#f8fafc] px-4 py-8 text-center text-sm text-slate-400">
              暂无自定义订阅。添加后将自动纳入资讯聚合。
            </div>
          ) : (
            <div className="space-y-2">
              {feeds.map((feed) => (
                <div key={feed.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-[#e2e8f0] p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-slate-900 truncate">{feed.name}</span>
                      <span className="shrink-0 rounded-full bg-[#f0f6ff] px-2 py-0.5 text-[10px] text-[#3d74ff]">RSS</span>
                    </div>
                    <a href={feed.url} target="_blank" rel="noreferrer"
                      className="mt-0.5 block truncate text-xs text-[#3d74ff] hover:underline">{feed.url}</a>
                    {feed.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {feed.tags.map((t) => (
                          <span key={t} className="rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] text-slate-500">{t}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] text-slate-400">
                      添加于 {new Date(feed.addedAt).toLocaleString("zh-CN")}
                    </div>
                  </div>
                  <button type="button" onClick={() => void handleDelete(feed.id)}
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    title="删除">
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}
