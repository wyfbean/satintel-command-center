"use client";

import "@copilotkit/react-ui/styles.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { CopilotKit, useCopilotAction, useCopilotChat, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import { fromBlob } from "geotiff";
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
type ClassStat = { class_id: number; pixels?: number; ratio?: number };
type Detection = { class?: string; confidence?: number; rbox?: number[]; bbox?: number[] };
type AttachedImage = {
  dataUrl: string;
  name: string;
  kind: "image" | "tiff";
  rawRef?: string;
  size?: number;
  metadata?: ImageMetadata;
};
type ImageMetadata = {
  sourceType: "raster-image" | "tiff-geotiff";
  filename: string;
  width: number;
  height: number;
  samplesPerPixel?: number;
  bitsPerSample?: number[];
  photometricInterpretation?: number;
  bbox?: number[];
  geoKeys?: Record<string, unknown>;
  previewSamples?: number[];
  previewMode?: "rgb" | "grayscale";
  inferredBand?: string;
  inferredRole?: string;
  rawRef?: string;
  note?: string;
};

// Distinct, high-contrast palette for segmentation class ids / detection boxes.
const SEG_PALETTE = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4",
  "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#6366f1", "#eab308",
];
const classColor = (id: number) => SEG_PALETTE[((id % SEG_PALETTE.length) + SEG_PALETTE.length) % SEG_PALETTE.length];

// Fixed starter prompts shown before the conversation begins — they steer users
// toward the agent's actual capabilities (the bundled model tools) instead of
// open-ended off-scope questions. Clicking one sends it straight to the agent.
const STARTER_QUESTIONS = [
  "你支持哪些遥感影像分析能力？请介绍可用的模型工具",
  "请对我附加的卫星图像进行场景描述与目标问答",
  "检测这张 SAR 图像中的目标，并标注旋转检测框",
  "对这张遥感图像进行地物语义分割（DOFA / SARMAE）",
];

/* ── workspace ────────────────────────────────────────────────────── */

function OrchestrationWorkspace() {
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [toolLog, setToolLog] = useState<ToolRecord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const { visibleMessages, appendMessage, isLoading } = useCopilotChat();
  // `visibleMessages` is undefined on the first render (before the agent connects),
  // despite its non-nullable type — guard it so we don't read `.length` of undefined.
  const conversationEmpty = (visibleMessages?.length ?? 0) === 0;
  const primaryImage = images[0] ?? null;

  useEffect(() => {
    let active = true;
    fetch("/api/agent/health?backend=orchestrator")
      .then((r) => r.json())
      .then((d) => active && setBackendOnline(Boolean(d?.ok)))
      .catch(() => active && setBackendOnline(false));
    return () => { active = false; };
  }, []);

  useCopilotReadable({ description: "attached_satellite_image", value: primaryImage?.rawRef ?? primaryImage?.dataUrl ?? "" });
  useCopilotReadable({
    description: "attached_satellite_images",
    value: images.length ? JSON.stringify(images.map(toAgentAttachment)) : "",
  });
  useCopilotReadable({
    description: "attached_image_metadata",
    value: images.length ? JSON.stringify(summarizeAttachments(images)) : "",
  });

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
      return <ToolCard name={name} args={args} status={status} result={result} image={primaryImage?.dataUrl ?? null} />;
    },
  });

  async function onPickImages(files: FileList) {
    setUploadError(null);
    const selected = Array.from(files).slice(0, 12);
    if (files.length > selected.length) {
      setUploadError(`一次最多附加 ${selected.length} 张图像，已忽略其余文件`);
    }
    try {
      const nextImages = await Promise.all(selected.map((file) => fileToAttachedImage(file, 720)));
      setImages((prev) => [...prev, ...nextImages].slice(0, 12));
    } catch (error) {
      setImages([]);
      setUploadError(error instanceof Error ? error.message : "无法解析该图像文件");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
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
              cd backend && python -m uvicorn app:app --port 6008
            </code>
          </div>
        )}

        <div className="border-b border-[#e2e8f0] px-5 py-3">
          <input ref={fileRef} type="file" accept="image/*,.tif,.tiff,.geotiff" multiple className="hidden"
            onChange={(e) => { const files = e.target.files; if (files?.length) void onPickImages(files); }} />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex-1 rounded-lg border border-dashed border-[#cbd5e1] px-3 py-2 text-xs text-slate-500 transition hover:border-[#3d74ff] hover:text-[#3d74ff]">
              {images.length ? `📎 ${images.length} 张图像` : "+ 附加卫星图像"}
            </button>
            {images.length > 0 && (
              <button type="button" onClick={() => setImages([])} className="rounded p-1 text-slate-400 hover:text-red-500">✕</button>
            )}
          </div>
          {images.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {images.map((item, index) => (
                <div key={`${item.name}_${index}`} className="relative overflow-hidden rounded-lg border border-[#e2e8f0] bg-[#f8fafc]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.dataUrl} alt="已附加图像" className="h-20 w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                    className="absolute right-1 top-1 rounded bg-white/90 px-1 text-[10px] text-slate-500 hover:text-red-500"
                  >
                    ✕
                  </button>
                  <div className="px-2 py-1">
                    <div className="truncate text-[10px] font-medium text-slate-600" title={item.name}>{item.name}</div>
                    {item.metadata && (
                      <div className="truncate text-[10px] text-slate-400" title={formatImageMetadata(item.metadata)}>
                        {formatImageMetadata(item.metadata)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {uploadError && (
            <div className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-600">
              {uploadError}
            </div>
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
                      {summarizeResult(t.result)}
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
        {conversationEmpty && (
          <div className="border-b border-[#e2e8f0] bg-white px-6 py-3">
            <SuggestedQuestions
              disabled={Boolean(isLoading)}
              onPick={(q) => { void appendMessage?.(new TextMessage({ content: q, role: Role.User })); }}
            />
          </div>
        )}
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

/* ── starter / guide questions (shown before the conversation begins) ── */

function SuggestedQuestions({ disabled, onPick }: { disabled: boolean; onPick: (q: string) => void }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium text-slate-400">引导问题 · 点击直接提问</div>
      <div className="flex flex-wrap gap-2">
        {STARTER_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={disabled}
            onClick={() => onPick(q)}
            className="rounded-full border border-[#dbe4ff] bg-[#f5f8ff] px-3 py-1.5 text-xs text-[#2f62d9] transition hover:border-[#3d74ff] hover:bg-[#eaf1ff] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {q}
          </button>
        ))}
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

  // The backend wraps every tool result in an envelope {ok, model, task, meta, result}.
  // Unwrap to the inner payload so mask/detections/regions live at the top level here;
  // fall back to `parsed` for any bare (non-enveloped) shape.
  const env = parsed as { ok?: unknown; model?: unknown; result?: unknown } | null;
  const data = (env && typeof env === "object" && typeof env.ok === "boolean" && "model" in env && env.ok
    && env.result && typeof env.result === "object")
    ? (env.result as Record<string, unknown>)
    : (parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null);

  const regions = data?.regions as Region[] | undefined;
  const objects = data?.objects as Record<string, unknown>[] | undefined;
  const rawMask = data?.mask;
  const mask = Array.isArray(rawMask) && Array.isArray(rawMask[0]) ? (rawMask as number[][]) : null;
  const rawDet = data?.detections;
  const detections = Array.isArray(rawDet) ? (rawDet as Detection[]) : null;
  const imageSize = (data?.image_size as number[] | undefined) ?? null;
  const classDist = (data?.class_distribution as ClassStat[] | undefined) ?? null;
  const headSource = (data?.head_source as string | undefined) ?? null;

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
        {mask && <MaskOverlay image={image} mask={mask} classDist={classDist} headSource={headSource} />}
        {detections && <DetectionOverlay image={image} detections={detections} imageSize={imageSize} headSource={headSource} />}
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
        {!mask && !detections && !regions && !objects && Boolean(parsed) && (
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

/* ── dense segmentation mask overlay (DOFA / SARMAE seg) ──────────── */

function MaskOverlay({ image, mask, classDist, headSource }: {
  image: string | null; mask: number[][]; classDist: ClassStat[] | null; headSource: string | null;
}) {
  // Render the class-id grid to a tiny canvas (1px/cell), upscaled by CSS — far
  // cheaper than thousands of SVG <rect>s. The square mask is stretched (fill) back
  // over the displayed image, which cancels the square-resize the backend applied.
  const maskUrl = useMemo(() => {
    const rows = mask.length, cols = mask[0]?.length ?? 0;
    if (!rows || !cols) return "";
    const canvas = document.createElement("canvas");
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = classColor(mask[r][c] | 0);
        ctx.fillRect(c, r, 1, 1);
      }
    }
    return canvas.toDataURL();
  }, [mask]);

  // Legend: prefer the backend's class_distribution; else derive uniques from the mask.
  const legend = useMemo<ClassStat[]>(() => {
    if (classDist && classDist.length) return [...classDist].sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
    const counts = new Map<number, number>();
    let total = 0;
    for (const row of mask) for (const v of row) { counts.set(v, (counts.get(v) ?? 0) + 1); total++; }
    return [...counts.entries()]
      .map(([class_id, pixels]) => ({ class_id, pixels, ratio: total ? pixels / total : 0 }))
      .sort((a, b) => b.ratio - a.ratio);
  }, [classDist, mask]);

  return (
    <div className="mb-2">
      <div className="relative overflow-hidden rounded-lg bg-[#0f172a]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={image} alt="分析图像" className="block w-full" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={maskUrl}
          alt="分割掩码"
          className={image ? "absolute inset-0 h-full w-full" : "block w-full"}
          style={{ imageRendering: "pixelated", opacity: image ? 0.5 : 1 }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {legend.map((s) => (
          <span key={s.class_id} className="flex items-center gap-1 text-[11px] text-slate-500">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: classColor(s.class_id) }} />
            类 {s.class_id}
            {typeof s.ratio === "number" && <span className="text-slate-400">{(s.ratio * 100).toFixed(1)}%</span>}
          </span>
        ))}
      </div>
      {headSource && <div className="mt-1.5 text-[10px] text-slate-400">分割头：{headSource}</div>}
    </div>
  );
}

/* ── detection overlay: rotated (rbox) + axis-aligned (bbox) boxes ──── */

function DetectionOverlay({ image, detections, imageSize, headSource }: {
  image: string | null; detections: Detection[]; imageSize: number[] | null; headSource: string | null;
}) {
  const [iw, ih] = imageSize && imageSize.length >= 2 ? imageSize : [0, 0];
  const rect = (x1: number, y1: number, x2: number, y2: number) => `${x1},${y1} ${x2},${y1} ${x2},${y2} ${x1},${y2}`;
  const polyFor = (d: Detection): string | null => {
    if (Array.isArray(d.rbox) && d.rbox.length === 5 && iw && ih) {
      const [cx, cy, w, h, a] = d.rbox; // rotated [cx,cy,w,h,angle] in pixels; angle assumed radians (mmrotate)
      const cos = Math.cos(a), sin = Math.sin(a);
      return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
        .map(([ox, oy]) => `${((cx + cos * ox - sin * oy) / iw * 100).toFixed(2)},${((cy + sin * ox + cos * oy) / ih * 100).toFixed(2)}`)
        .join(" ");
    }
    if (Array.isArray(d.bbox) && d.bbox.length >= 4) {
      const [x1, y1, x2, y2] = d.bbox; // k-means proxy bbox is already in 0–100 viewBox coords
      return rect(x1, y1, x2, y2);
    }
    if (Array.isArray(d.rbox) && d.rbox.length === 4 && iw && ih) {
      const [x1, y1, x2, y2] = d.rbox.map((v, k) => (v / (k % 2 === 0 ? iw : ih)) * 100); // axis-aligned pixels → normalize
      return rect(x1, y1, x2, y2);
    }
    return null;
  };

  return (
    <div className="mb-2">
      <div className="relative overflow-hidden rounded-lg bg-[#0f172a]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={image} alt="分析图像" className="block w-full" />}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {detections.map((d, i) => {
            const pts = polyFor(d);
            if (!pts) return null;
            const color = classColor(i);
            return <polygon key={i} points={pts} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={0.6} />;
          })}
        </svg>
      </div>
      <div className="mt-2 space-y-1">
        {detections.slice(0, 12).map((d, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg bg-[#f8fafc] px-3 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 font-medium text-slate-700">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: classColor(i) }} />
              {String(d.class ?? "目标")}
            </span>
            <span className="text-slate-400">置信度 {d.confidence != null ? Number(d.confidence).toFixed(2) : "—"}</span>
          </div>
        ))}
        {detections.length > 12 && <div className="text-[11px] text-slate-400">…共 {detections.length} 个目标</div>}
        {detections.length === 0 && <div className="rounded-lg bg-[#f8fafc] px-3 py-2 text-center text-xs text-slate-400">未检出目标</div>}
      </div>
      {headSource && <div className="mt-1.5 text-[10px] text-slate-400">检测头：{headSource}</div>}
    </div>
  );
}

/* ── compact one-liner for the left-panel tool log (never stringifies dense masks) ── */

function summarizeResult(result: unknown): string {
  const parsed = parseMaybeJson(result);
  if (parsed && typeof parsed === "object") {
    const env = parsed as Record<string, unknown>;
    const o = (env.result && typeof env.result === "object" ? env.result : env) as Record<string, unknown>;
    if (Array.isArray(o.mask)) return `分割掩码 ${o.mask.length}×${(o.mask[0] as unknown[])?.length ?? 0}，${o.num_classes ?? "?"} 类`;
    if (Array.isArray(o.detections)) return `检测到 ${o.detections.length} 个目标`;
    if (env.ok === false && typeof env.error === "string") return `失败：${env.error}`;
  }
  return (typeof result === "string" ? result : JSON.stringify(result)).slice(0, 72);
}

function parseMaybeJson(v: unknown): unknown {
  if (v && typeof v === "object") return v;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return v ? { value: v } : null; } }
  return null;
}

function isTiffFile(file: File): boolean {
  return /\.(tif|tiff|geotiff)$/i.test(file.name)
    || ["image/tiff", "image/geotiff", "application/geotiff"].includes(file.type);
}

async function fileToAttachedImage(file: File, maxSize: number): Promise<AttachedImage> {
  const [attached, rawRef] = await Promise.all([
    isTiffFile(file) ? tiffToAttachedImage(file, maxSize) : browserImageToAttachedImage(file, maxSize),
    uploadRawImage(file),
  ]);
  const band = inferBandFromName(file.name);
  const metadata: ImageMetadata = {
    ...attached.metadata,
    sourceType: attached.metadata?.sourceType ?? (isTiffFile(file) ? "tiff-geotiff" : "raster-image"),
    filename: file.name,
    width: attached.metadata?.width ?? 0,
    height: attached.metadata?.height ?? 0,
    inferredBand: band?.band,
    inferredRole: band?.role,
    rawRef,
  };
  return { ...attached, rawRef, size: file.size, metadata };
}

async function uploadRawImage(file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch("/api/uploads/satellite", { method: "POST", body: form });
  const payload = await response.json().catch(() => null) as { ok?: boolean; path?: string; error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.path) {
    throw new Error(payload?.error ?? `原始影像上传失败 (${response.status})`);
  }
  return payload.path;
}

async function browserImageToAttachedImage(file: File, maxSize: number): Promise<AttachedImage> {
  const dataUrl = await downscaleToDataUrl(file, maxSize);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  bitmap.close();
  return {
    dataUrl,
    name: file.name,
    kind: "image",
    metadata: {
      sourceType: "raster-image",
      filename: file.name,
      width,
      height,
      samplesPerPixel: 3,
      previewMode: "rgb",
    },
  };
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
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

type TypedRaster = ArrayLike<number>;
type GeoTiffDirectory = {
  ImageWidth?: number;
  ImageLength?: number;
  SamplesPerPixel?: number;
  BitsPerSample?: number | number[];
  PhotometricInterpretation?: number;
};
type GeoTiffImageLike = {
  getWidth: () => number;
  getHeight: () => number;
  getSamplesPerPixel?: () => number;
  getBoundingBox?: () => number[];
  getGeoKeys?: () => Record<string, unknown>;
  fileDirectory?: GeoTiffDirectory;
  readRasters: (options: {
    samples?: number[];
    width?: number;
    height?: number;
    interleave?: boolean;
    resampleMethod?: "nearest" | "bilinear";
  }) => Promise<unknown>;
};

async function tiffToAttachedImage(file: File, maxSize: number): Promise<AttachedImage> {
  const tiff = await fromBlob(file);
  const image = await tiff.getImage() as GeoTiffImageLike;
  const sourceWidth = image.getWidth();
  const sourceHeight = image.getHeight();
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const samplesPerPixel = getSamplesPerPixel(image);
  const previewSamples = samplesPerPixel >= 3 ? [0, 1, 2] : [0];
  const rasters = await image.readRasters({
    samples: previewSamples,
    width,
    height,
    interleave: false,
    resampleMethod: "bilinear",
  });
  const bands = toBandArray(rasters);
  if (bands.length === 0 || bands.some((band) => band.length < width * height)) {
    throw new Error("TIFF 已读取，但未能生成可显示预览");
  }

  const dataUrl = rastersToDataUrl(bands, width, height, previewSamples.length >= 3);
  const fileDirectory = image.fileDirectory ?? {};
  const metadata: ImageMetadata = {
    sourceType: "tiff-geotiff",
    filename: file.name,
    width: sourceWidth,
    height: sourceHeight,
    samplesPerPixel,
    bitsPerSample: normalizeNumberArray(fileDirectory.BitsPerSample),
    photometricInterpretation: fileDirectory.PhotometricInterpretation,
    bbox: safeCallNumberArray(() => image.getBoundingBox?.()),
    geoKeys: safeCallGeoKeys(() => image.getGeoKeys?.()),
    previewSamples,
    previewMode: previewSamples.length >= 3 ? "rgb" : "grayscale",
    note: "The attached_satellite_image is a normalized preview derived from the TIFF/GeoTIFF; use this metadata to decide whether SAR or multispectral tools are appropriate.",
  };

  return { dataUrl, name: file.name, kind: "tiff", metadata };
}

function getSamplesPerPixel(image: GeoTiffImageLike): number {
  const fromDirectory = image.fileDirectory?.SamplesPerPixel;
  if (typeof fromDirectory === "number" && Number.isFinite(fromDirectory) && fromDirectory > 0) return fromDirectory;
  const fromMethod = image.getSamplesPerPixel?.();
  if (typeof fromMethod === "number" && Number.isFinite(fromMethod) && fromMethod > 0) return fromMethod;
  return 1;
}

function toBandArray(rasters: unknown): TypedRaster[] {
  if (!Array.isArray(rasters)) return [];
  return rasters.filter((band): band is TypedRaster => Boolean(band) && typeof band === "object" && "length" in band);
}

function rastersToDataUrl(bands: TypedRaster[], width: number, height: number, rgb: boolean): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const imageData = ctx.createImageData(width, height);
  const stretches = bands.map((band) => bandStretch(band));
  const firstBand = bands[0];
  const firstStretch = stretches[0];

  for (let i = 0; i < width * height; i++) {
    const out = i * 4;
    if (rgb && bands.length >= 3) {
      imageData.data[out] = stretchValue(bands[0][i], stretches[0]);
      imageData.data[out + 1] = stretchValue(bands[1][i], stretches[1]);
      imageData.data[out + 2] = stretchValue(bands[2][i], stretches[2]);
    } else {
      const v = stretchValue(firstBand[i], firstStretch);
      imageData.data[out] = v;
      imageData.data[out + 1] = v;
      imageData.data[out + 2] = v;
    }
    imageData.data[out + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function bandStretch(band: TypedRaster): { min: number; max: number } {
  const values: number[] = [];
  const stride = Math.max(1, Math.floor(band.length / 60000));
  for (let i = 0; i < band.length; i += stride) {
    const v = Number(band[i]);
    if (Number.isFinite(v)) values.push(v);
  }
  if (values.length === 0) return { min: 0, max: 1 };
  values.sort((a, b) => a - b);
  const lo = values[Math.floor((values.length - 1) * 0.02)];
  const hi = values[Math.floor((values.length - 1) * 0.98)];
  if (hi > lo) return { min: lo, max: hi };
  const min = values[0];
  const max = values[values.length - 1];
  return max > min ? { min, max } : { min: min - 1, max: max + 1 };
}

function stretchValue(value: number, stretch: { min: number; max: number }): number {
  const normalized = (Number(value) - stretch.min) / (stretch.max - stretch.min);
  return Math.max(0, Math.min(255, Math.round(normalized * 255)));
}

function normalizeNumberArray(value: number | number[] | undefined): number[] | undefined {
  if (Array.isArray(value)) return value.filter((v) => Number.isFinite(v));
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  return undefined;
}

function safeCallNumberArray(read: () => number[] | undefined): number[] | undefined {
  try {
    const value = read();
    return Array.isArray(value) ? value.filter((v) => Number.isFinite(v)) : undefined;
  } catch {
    return undefined;
  }
}

function safeCallGeoKeys(read: () => Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  try {
    const keys = read();
    if (!keys || typeof keys !== "object") return undefined;
    return Object.fromEntries(Object.entries(keys).slice(0, 32));
  } catch {
    return undefined;
  }
}

function formatImageMetadata(metadata: ImageMetadata): string {
  const type = metadata.sourceType === "tiff-geotiff" ? "TIFF/GeoTIFF" : "Image";
  const bands = metadata.samplesPerPixel ? ` · ${metadata.samplesPerPixel} bands` : "";
  const bits = metadata.bitsPerSample?.length ? ` · ${metadata.bitsPerSample.join("/")}-bit` : "";
  const inferred = metadata.inferredBand ? ` · ${metadata.inferredBand}` : "";
  return `${type} · ${metadata.width}×${metadata.height}${bands}${bits}${inferred}`;
}

function inferBandFromName(name: string): { band: string; role: string } | null {
  const upper = name.toUpperCase();
  const match = upper.match(/(?:^|[_\-.])B(0[1-9]|1[0-2]|8A|8)(?:[_\-.]|$)/);
  let band: string | null = null;
  if (match) {
    band = match[1] === "8" ? "B08" : `B${match[1]}`;
  } else if (/(?:^|[_\-.])(NIR|NEAR[_\-.]?INFRARED)(?:[_\-.]|$)/.test(upper)) {
    band = "B08";
  }
  if (!band) return null;
  const roles: Record<string, string> = {
    B01: "coastal",
    B02: "Blue",
    B03: "Green",
    B04: "Red",
    B05: "RedEdge1",
    B06: "RedEdge2",
    B07: "RedEdge3",
    B08: "NIR",
    B8A: "NarrowNIR",
    B09: "WaterVapor",
    B10: "Cirrus",
    B11: "SWIR1",
    B12: "SWIR2",
  };
  return { band, role: roles[band] ?? band };
}

function toAgentAttachment(image: AttachedImage): Record<string, unknown> {
  return {
    name: image.name,
    kind: image.kind,
    rawRef: image.rawRef,
    size: image.size,
    metadata: image.metadata,
  };
}

function summarizeAttachments(images: AttachedImage[]): Record<string, unknown> {
  const bands = images
    .map((image) => image.metadata?.inferredBand)
    .filter((band): band is string => Boolean(band));
  return {
    count: images.length,
    primary: images[0]?.metadata,
    images: images.map((image) => image.metadata),
    inferredBands: bands,
    likelyMultiBandSet: bands.length >= 3,
    note: images.length > 1
      ? "Multiple attachments may represent separate spectral bands of one multispectral sample; match by inferredBand/rawRef before choosing DOFA multispectral heads."
      : undefined,
  };
}
