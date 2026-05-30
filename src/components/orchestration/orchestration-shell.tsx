"use client";

import "@copilotkit/react-ui/styles.css";

import { useEffect, useRef, useState } from "react";
import { CopilotKit, useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";

import { SiteNav } from "@/components/site-nav";

const AGENT_NAME = "satelliteAnalyst";

export function OrchestrationShell() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_NAME}>
      <AnalystWorkspace />
    </CopilotKit>
  );
}

function AnalystWorkspace() {
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Surface backend availability so the user knows if the Python agent isn't running.
  useEffect(() => {
    let active = true;
    fetch("/api/agent/health")
      .then((r) => r.json())
      .then((d) => active && setBackendOnline(Boolean(d?.ok)))
      .catch(() => active && setBackendOnline(false));
    return () => {
      active = false;
    };
  }, []);

  // The attached satellite image is passed to the agent as AG-UI context; the CrewAI
  // backend reads it and the image tools (segment_image/detect_objects) act on it.
  useCopilotReadable({
    description: "attached_satellite_image",
    value: image?.dataUrl ?? "",
  });

  // Render any MCP/A2A tool call the agent makes as an inline result card.
  useCopilotAction({
    name: "*",
    render: ({ name, args, status, result }: { name: string; args: unknown; status: string; result: unknown }) => (
      <ToolResultCard name={name} args={args} status={status} result={result} image={image?.dataUrl ?? null} />
    ),
  });

  async function onPickImage(file: File) {
    const dataUrl = await downscaleToDataUrl(file, 720);
    setImage({ dataUrl, name: file.name });
  }

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[920px] flex-col px-4 py-5 sm:px-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1f2430] text-xs font-semibold text-white">
              CrewAI
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">卫星智能体分析</div>
              <div className="text-xs text-slate-400">CrewAI 多智能体 · MCP 工具调用 · AG-UI</div>
            </div>
          </div>
          <SiteNav />
        </header>

        {backendOnline === false ? (
          <div className="mt-4 rounded-2xl border border-[#fde0c4] bg-[#fff8ef] px-4 py-3 text-sm text-[#b7791f]">
            未连接到 Agent 后端（uvicorn :8000）。请在 <code>backend/</code> 运行
            <code className="mx-1">uv run uvicorn app:app --port 8000</code>。当前对话将无法获得回复。
          </div>
        ) : null}

        {/* Image attach bar */}
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[#ebedf2] bg-white px-4 py-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickImage(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-full border border-[#dbe4ff] bg-[#f4f7ff] px-4 py-2 text-sm font-medium text-[#2f62d9] transition hover:bg-[#e9f0ff]"
          >
            + 附加卫星图像
          </button>
          {image ? (
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.dataUrl} alt="attached" className="h-9 w-9 rounded-lg object-cover" />
              <span className="max-w-[160px] truncate text-xs text-slate-500">{image.name}</span>
              <button type="button" onClick={() => setImage(null)} className="text-xs text-slate-400 hover:text-slate-700">
                移除
              </button>
            </div>
          ) : (
            <span className="text-xs text-slate-400">附加后，向智能体提问即可对图像进行分割 / 目标检测等工具调用。</span>
          )}
        </div>

        {/* Full-window ChatGPT-style chat */}
        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-[#ebedf2] bg-white shadow-[0_14px_34px_rgba(28,42,71,0.06)]">
          <CopilotChat
            className="h-full"
            labels={{
              title: "卫星智能体",
              initial:
                "你好，我是卫星情报多智能体助手（CrewAI）。可以让我分析一片区域、检索某颗卫星的轨道，或附加一张卫星图像让我做目标检测 / 分割。",
              placeholder: "描述你的分析任务，或附加卫星图像后提问……",
            }}
          />
        </div>
      </div>
    </main>
  );
}

function ToolResultCard({
  name,
  args,
  status,
  result,
  image,
}: {
  name: string;
  args: unknown;
  status: string;
  result: unknown;
  image: string | null;
}) {
  const parsed = parseMaybeJson(result);
  const argObj = parseMaybeJson(args);
  const regions = (parsed as { regions?: Region[] } | null)?.regions;
  const objects = (parsed as { objects?: Record<string, unknown>[] } | null)?.objects;

  return (
    <div className="my-2 rounded-[16px] border border-[#dbe4ff] bg-[#f7faff] p-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-[#2f62d9]">🛠 {name}</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500">{status}</span>
      </div>

      {regions && image ? (
        <SegmentationOverlay image={image} regions={regions} />
      ) : null}

      {objects ? (
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {objects.map((o, i) => (
            <li key={i} className="rounded-md bg-white px-2 py-1">
              {String(o.class ?? "object")} · conf {String(o.confidence ?? "—")}
            </li>
          ))}
        </ul>
      ) : null}

      {!regions && !objects && parsed ? (
        <pre className="scrollbar-thin mt-2 max-h-40 overflow-auto rounded-[10px] bg-[#0f172a] p-2 text-[11px] leading-5 text-[#dbeafe]">
          <code>{JSON.stringify(parsed, null, 2)}</code>
        </pre>
      ) : null}

      {argObj && Object.keys(argObj as object).length > 0 ? (
        <div className="mt-2 text-[11px] text-slate-400">args: {JSON.stringify(argObj)}</div>
      ) : null}
    </div>
  );
}

type Region = { label: string; bbox: [number, number, number, number]; color: string; score: number };

function SegmentationOverlay({ image, regions }: { image: string; regions: Region[] }) {
  return (
    <div className="relative mt-2 overflow-hidden rounded-[12px] border border-[#e3e9f6]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="analysis" className="block w-full" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {regions.map((r, i) => {
          const [x1, y1, x2, y2] = r.bbox;
          return (
            <g key={i}>
              <rect
                x={x1}
                y={y1}
                width={Math.max(0, x2 - x1)}
                height={Math.max(0, y2 - y1)}
                fill={r.color}
                fillOpacity={0.18}
                stroke={r.color}
                strokeWidth={0.6}
              />
              <text x={x1 + 1} y={y1 + 4} fontSize={3} fill={r.color}>
                {r.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function parseMaybeJson(v: unknown): unknown {
  if (v && typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v ? { value: v } : null;
    }
  }
  return null;
}

async function downscaleToDataUrl(file: File, maxSize: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}
