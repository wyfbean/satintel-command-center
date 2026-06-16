"use client";

import "@copilotkit/react-ui/styles.css";

import { useEffect, useRef, useState } from "react";
import { CopilotKit, useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { AppSidebar } from "@/components/app-sidebar";

/* ── public export ────────────────────────────────────────────────── */

export function OrchestrationShell() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="magneticOrchestrator">
      <div className="flex h-screen overflow-hidden bg-[#f4f5f7] font-sans text-slate-900">
        <AppSidebar />
        <OrchestrationWorkspace />
      </div>
    </CopilotKit>
  );
}

/* ── types ────────────────────────────────────────────────────────── */

type ToolRecord = { id: string; name: string; status: "pending" | "complete"; result: unknown };
type Region = { label: string; bbox: [number, number, number, number]; color: string; score: number };

/* ── workspace ────────────────────────────────────────────────────── */

function OrchestrationWorkspace() {
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [toolLog, setToolLog] = useState<ToolRecord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/agent/health?backend=orchestrator")
      .then((r) => r.json())
      .then((d) => active && setBackendOnline(Boolean(d?.ok)))
      .catch(() => active && setBackendOnline(false));
    return () => { active = false; };
  }, []);

  useCopilotReadable({ description: "attached_satellite_image", value: image?.dataUrl ?? "" });

  useCopilotAction({
    name: "*",
    render: ({ name, args, status, result }: { name: string; args: unknown; status: string; result: unknown }) => {
      if (status === "inProgress") {
        // Defer past the current render/effect pass — CopilotKit invokes this render
        // callback from inside its own useEffect, so a synchronous setState here
        // triggers React's "update while rendering a different component" warning.
        queueMicrotask(() => setToolLog((p) => {
          if (p.some((t) => t.name === name && t.status === "pending")) return p;
          return [{ id: `${Date.now()}_${name}`, name, status: "pending", result: null }, ...p.slice(0, 19)];
        }));
      }
      if (status === "complete") {
        queueMicrotask(() => setToolLog((p) => {
          if (!p.some((t) => t.name === name && t.status === "pending")) return p;
          return p.map((t) => (t.name === name && t.status === "pending") ? { ...t, status: "complete", result } : t);
        }));
      }
      return <ToolCard name={name} args={args} status={status} result={result} image={image?.dataUrl ?? null} />;
    },
  });

  async function onPickImage(file: File) {
    const dataUrl = await downscaleToDataUrl(file, 720);
    setImage({ dataUrl, name: file.name });
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ── left panel ── */}
      <div className="flex w-72 flex-none flex-col border-r border-[#e2e8f0] bg-white xl:w-80">
        <div className="border-b border-[#e2e8f0] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#3d74ff]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <circle cx="12" cy="8" r="4" /><path d="M6 20v-1a6 6 0 0 1 12 0v1" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold">遥感分析智能体</div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className={`h-1.5 w-1.5 rounded-full ${backendOnline === true ? "bg-[#22c55e]" : backendOnline === false ? "bg-red-400" : "bg-amber-400"}`} />
                {backendOnline === true ? "在线 · Magnetic-One" : backendOnline === false ? "后端离线" : "连接中…"}
              </div>
            </div>
          </div>
        </div>

        {backendOnline === false && (
          <div className="border-b border-[#fde8d3] bg-[#fff7ed] px-4 py-2.5 text-xs text-[#c2410c]">
            运行：<code className="rounded bg-[#ffedd5] px-1 py-0.5">
              cd backend && uv run uvicorn app:app --port 8000
            </code>
          </div>
        )}

        <div className="border-b border-[#e2e8f0] px-5 py-3">
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickImage(f); }} />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex-1 rounded-lg border border-dashed border-[#cbd5e1] px-3 py-2 text-xs text-slate-500 transition hover:border-[#3d74ff] hover:text-[#3d74ff]">
              {image ? `📎 ${image.name}` : "+ 附加卫星图像"}
            </button>
            {image && (
              <button type="button" onClick={() => setImage(null)} className="rounded p-1 text-slate-400 hover:text-red-500">✕</button>
            )}
          </div>
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.dataUrl} alt="已附加图像" className="mt-2 w-full rounded-lg object-cover" style={{ maxHeight: 120 }} />
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">工具调用记录</div>
          {toolLog.length === 0 ? (
            <div className="rounded-lg bg-[#f8fafc] px-3 py-6 text-center text-xs text-slate-400">发送消息后工具调用会显示在此</div>
          ) : (
            <div className="space-y-2">
              {toolLog.map((t) => (
                <div key={t.id} className={`rounded-lg border p-2.5 text-xs ${t.status === "complete" ? "border-[#dcfce7] bg-[#f0fdf4]" : "border-[#e2e8f0] bg-white"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[#3d74ff]">{t.name}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${t.status === "complete" ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#fef9c3] text-[#854d0e]"}`}>
                      {t.status === "complete" ? "✓" : "⋯"}
                    </span>
                  </div>
                  {Boolean(t.result) && (
                    <div className="mt-1 truncate text-slate-400">
                      {(typeof t.result === "string" ? t.result : JSON.stringify(t.result)).slice(0, 72)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[#e2e8f0] px-5 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            可用模型工具
          </div>
          <div className="space-y-1 text-xs">
            {["skyeyegpt", "sarmae", "dofa", "sattxt", "mtp"].map((t) => (
              <div key={t} className="flex items-center gap-2 text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-[#3d74ff]" />
                <span className="font-mono">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── main chat ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] bg-white px-6 py-3">
          <div>
            <h1 className="text-sm font-semibold">遥感分析智能体</h1>
            <p className="text-xs text-slate-400">Magnetic-One · model_wrappers · AG-UI</p>
          </div>
          <span className="hidden rounded-full bg-[#f1f5f9] px-3 py-1 text-xs text-slate-500 xl:inline">
            单智能体 · 模型工具调用
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden bg-[#f9fafb]">
          <CopilotChat
            className="h-full"
            labels={{
              title: "遥感分析智能体",
              initial: "你好，我是遥感分析智能体。描述分析需求，或附加卫星 / SAR 图像后提问，我会调用 DOFA / SATtxt / MTP 等模型工具完成分析。",
              placeholder: "描述分析任务，或附加图像后提问……",
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── inline tool card ─────────────────────────────────────────────── */

function ToolCard({ name, args, status, result, image }: {
  name: string; args: unknown; status: string; result: unknown; image: string | null;
}) {
  const parsed = parseMaybeJson(result);
  const argObj = parseMaybeJson(args);
  const regions = (parsed as { regions?: Region[] } | null)?.regions;
  const objects = (parsed as { objects?: Record<string, unknown>[] } | null)?.objects;

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-[#dbe4ff] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#f0f4ff] px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">🛠</span>
          <span className="font-mono text-xs font-semibold text-[#2f62d9]">{name}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status === "complete" ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#fef9c3] text-[#854d0e]"}`}>
          {status === "complete" ? "完成" : status}
        </span>
      </div>
      <div className="p-3">
        {regions && image && <SegmentationOverlay image={image} regions={regions} />}
        {objects && (
          <div className="space-y-1">
            {objects.map((o, i) => (
              <div key={i} className="flex justify-between rounded-lg bg-[#f8fafc] px-3 py-1.5 text-xs">
                <span className="font-medium text-slate-700">{String(o.class ?? "目标")}</span>
                <span className="text-slate-400">置信度 {String(o.confidence ?? "—")}</span>
              </div>
            ))}
          </div>
        )}
        {!regions && !objects && Boolean(parsed) && (
          <pre className="max-h-36 overflow-auto rounded-lg bg-[#0f172a] p-2.5 text-[11px] leading-5 text-[#dbeafe]">
            <code>{JSON.stringify(parsed, null, 2)}</code>
          </pre>
        )}
        {Boolean(argObj) && Object.keys(argObj as object).length > 0 && (
          <div className="mt-1.5 text-[11px] text-slate-400">参数: {JSON.stringify(argObj)}</div>
        )}
      </div>
    </div>
  );
}

function SegmentationOverlay({ image, regions }: { image: string; regions: Region[] }) {
  return (
    <div className="relative mb-2 overflow-hidden rounded-lg">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="分析图像" className="block w-full" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {regions.map((r, i) => {
          const [x1, y1, x2, y2] = r.bbox;
          return (
            <g key={i}>
              <rect x={x1} y={y1} width={Math.max(0, x2 - x1)} height={Math.max(0, y2 - y1)}
                fill={r.color} fillOpacity={0.18} stroke={r.color} strokeWidth={0.6} />
              <text x={x1 + 1} y={y1 + 4} fontSize={3} fill={r.color}>{r.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function parseMaybeJson(v: unknown): unknown {
  if (v && typeof v === "object") return v;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return v ? { value: v } : null; } }
  return null;
}

async function downscaleToDataUrl(file: File, maxSize: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}


