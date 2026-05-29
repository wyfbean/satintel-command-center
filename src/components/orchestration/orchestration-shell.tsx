"use client";

import "@copilotkit/react-ui/styles.css";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CopilotKit, useCoAgent, useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";

import type { OrchestrationAgentState } from "@/lib/a2a/orchestration-agent";
import type { A2ATaskState } from "@/types/a2a";

const AGENT_NAME = "orchestration";

const taskStateLabel: Record<A2ATaskState, string> = {
  submitted: "已提交",
  working: "处理中",
  "input-required": "需要输入",
  completed: "已完成",
  canceled: "已取消",
  failed: "失败",
  unknown: "未知",
};

const taskStateTone: Record<A2ATaskState, string> = {
  submitted: "border-[#dbe4ff] bg-[#f3f6ff] text-[#2f62d9]",
  working: "border-[#fde7bd] bg-[#fff8eb] text-[#b7791f]",
  "input-required": "border-[#fbd2d2] bg-[#fff1f1] text-[#c2410c]",
  completed: "border-[#cdeed7] bg-[#eefbf1] text-[#15803d]",
  canceled: "border-[#e5e7eb] bg-[#f8fafc] text-slate-500",
  failed: "border-[#fecaca] bg-[#fff1f2] text-[#be123c]",
  unknown: "border-[#e5e7eb] bg-[#f8fafc] text-slate-500",
};

const initialState: OrchestrationAgentState = {
  goal: "正在连接 A2A Host，准备回放多智能体编排过程……",
  sessionId: "—",
  statusMessage: "等待 RUN_STARTED 事件。",
  taskState: "submitted",
  agents: [],
  edges: [],
  workflow: [],
  timeline: [],
  artifacts: [],
  finalResult: null,
  metrics: { activeAgents: 0, taskUpdates: 0, artifacts: 0, meanLatencyMs: 0 },
};

export function OrchestrationShell() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_NAME}>
      <OrchestrationWorkspace />
    </CopilotKit>
  );
}

function OrchestrationWorkspace() {
  const { state: agentState, running, run } = useCoAgent<OrchestrationAgentState>({
    name: AGENT_NAME,
    initialState,
  });
  // CopilotKit may seed coagent state as `{}` before initialState/the first
  // STATE_SNAPSHOT lands, so merge over initialState rather than nullish-guarding.
  const state: OrchestrationAgentState = { ...initialState, ...(agentState ?? {}) };

  // Auto-start the A2A replay once on mount (no user message required).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  // Channel 2: every A2A "state call" the agent makes is rendered as a card.
  useCopilotAction({
    name: "*",
    render: ({ name, args, status }: { name: string; args: unknown; status: string }) => (
      <StateCallCard name={name} args={args} status={status} />
    ),
  });

  const agentName = (agentId: string) => state.agents.find((a) => a.id === agentId)?.name ?? agentId;

  return (
    <main className="panel-grid min-h-screen px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-7">
        <header className="rounded-[34px] border border-[#ebedf2] bg-white/90 p-5 shadow-[0_18px_44px_rgba(28,42,71,0.08)] backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1f2430] text-sm font-semibold text-white">
                A2A
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">卫星情报多智能体编排（AG-UI）</div>
                <div className="text-xs text-slate-400">CopilotKit · AG-UI 事件流 · 实时状态与 artifact</div>
              </div>
            </div>
            <nav className="flex flex-wrap items-center gap-3 text-sm">
              <Link href="/" className="rounded-full border border-[#e8ebf0] bg-white px-4 py-2 text-slate-600">
                资讯流
              </Link>
              <Link href="/dashboard" className="rounded-full border border-[#e8ebf0] bg-white px-4 py-2 text-slate-600">
                对话面板
              </Link>
              <span className="rounded-full bg-[#1f2430] px-4 py-2 font-medium text-white">Agent 编排</span>
            </nav>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className={`status-dot ${running ? "live" : ""}`} />
            <span className={`rounded-full border px-3 py-1 text-sm font-medium ${taskStateTone[state.taskState]}`}>
              {taskStateLabel[state.taskState]}
            </span>
            <span className="text-sm text-slate-400">{running ? "事件流进行中" : "事件流已结束"} · {state.sessionId}</span>
          </div>
          <h1 className="mt-5 max-w-5xl text-3xl font-semibold leading-tight text-slate-950 md:text-5xl">
            可解释的 A2A 协作流程与最终产出
          </h1>
          <p className="mt-4 max-w-4xl text-[16px] leading-7 text-slate-500">{state.goal}</p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Agents" value={state.metrics.activeAgents} />
            <Metric label="Artifacts" value={state.artifacts.length} tone="text-[#15803d]" />
            <Metric label="Task updates" value={state.timeline.length} tone="text-[#b7791f]" />
            <Metric label="Mean latency" value={`${state.metrics.meanLatencyMs}ms`} />
          </div>
        </header>

        <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
          <div className="min-w-0 space-y-6">
            <Panel kicker="AgentCard Registry" title="能力与信任边界">
              {state.agents.length === 0 ? (
                <Empty>等待 AgentCard discovery……</Empty>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {state.agents.map((agent) => (
                    <div key={agent.id} className="rounded-[20px] border border-[#ebedf2] bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">{agent.name}</div>
                        <span className="rounded-full border border-[#dbe4ff] bg-white px-2.5 py-1 text-xs text-[#3d74ff]">
                          {agent.role}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{agent.endpoint}</div>
                      <p className="mt-3 text-xs leading-5 text-slate-500">{agent.trustBoundary}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {agent.skills.map((skill) => (
                          <span key={skill} className="rounded-full bg-[#f6f8fb] px-2.5 py-1 text-xs text-slate-500">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel kicker="A2A Workflow" title="Agent0 编排拓扑">
              {state.workflow.length === 0 ? (
                <Empty>等待编排步骤……</Empty>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {state.workflow.map((step) => (
                    <div key={step.id} className="rounded-[20px] border border-[#e3e9f6] bg-white p-4">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${taskStateTone[step.taskState]}`}>
                        {taskStateLabel[step.taskState]}
                      </span>
                      <h3 className="mt-3 text-base font-semibold text-slate-900">{step.title}</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{step.subtitle}</p>
                      <div className="mt-3 text-xs text-[#3d74ff]">{agentName(step.agentId)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel kicker="Artifacts" title="交付物栈">
              {state.artifacts.length === 0 ? (
                <Empty>等待 artifact-update 事件……</Empty>
              ) : (
                <div className="space-y-3">
                  {state.artifacts.map((artifact) => (
                    <article key={artifact.id} className="rounded-[20px] border border-[#ebedf2] bg-[#fbfbfc] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="text-sm font-semibold text-slate-900">{artifact.title}</h4>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs text-[#15803d]">{artifact.status}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-500">{artifact.summary}</p>
                      <div className="mt-3 space-y-1">
                        {artifact.parts.map((part) => (
                          <div key={part} className="text-xs leading-5 text-slate-400">
                            {part}
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            {state.finalResult ? (
              <Panel kicker="Final Result" title={state.finalResult.title} dark>
                <p className="text-sm leading-7 text-slate-300">{state.finalResult.summary}</p>
                <div className="mt-4 space-y-2">
                  {state.finalResult.decisions.map((decision) => (
                    <div key={decision} className="rounded-[16px] bg-white/8 px-4 py-3 text-sm leading-6 text-slate-200">
                      {decision}
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-white/10 pt-4 text-xs uppercase tracking-[0.18em] text-[#93c5fd]">
                  Next Actions
                </div>
                <div className="mt-2 space-y-1">
                  {state.finalResult.nextActions.map((action) => (
                    <div key={action} className="text-sm leading-6 text-slate-300">
                      {action}
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </div>

          <aside className="xl:sticky xl:top-6">
            <div className="flex h-[78vh] flex-col overflow-hidden rounded-[30px] border border-[#ebedf2] bg-white shadow-[0_14px_34px_rgba(28,42,71,0.06)]">
              <div className="border-b border-[#eff1f4] px-5 py-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">AG-UI Conversation</div>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">智能体协作对话</h2>
              </div>
              <div className="min-h-0 flex-1">
                <CopilotChat
                  className="h-full"
                  labels={{
                    title: "A2A 编排",
                    initial: "正在回放多智能体编排事件流。你也可以追加指令，重新触发一次编排。",
                    placeholder: "向 Host Agent 追加指令……",
                  }}
                />
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function StateCallCard({ name, args, status }: { name: string; args: unknown; status: string }) {
  let parsed: Record<string, unknown> | null = null;
  if (args && typeof args === "object") parsed = args as Record<string, unknown>;

  return (
    <div className="my-2 rounded-[18px] border border-[#dbe4ff] bg-[#f7faff] p-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-[#2f62d9]">{name}</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500">{status}</span>
      </div>
      {parsed ? (
        <pre className="scrollbar-thin mt-2 max-h-40 overflow-auto rounded-[12px] bg-[#0f172a] p-3 text-[11px] leading-5 text-[#dbeafe]">
          <code>{JSON.stringify(parsed, null, 2)}</code>
        </pre>
      ) : null}
    </div>
  );
}

function Metric({ label, value, tone = "text-slate-900" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-[20px] border border-[#ebedf2] bg-[#fafbff] p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function Panel({
  kicker,
  title,
  children,
  dark,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <section
      className={`rounded-[28px] border p-5 shadow-[0_14px_34px_rgba(28,42,71,0.06)] ${
        dark ? "border-[#1f2937] bg-[#111827] text-white" : "border-[#ebedf2] bg-white"
      }`}
    >
      <div className={`text-xs font-medium uppercase tracking-[0.18em] ${dark ? "text-[#93c5fd]" : "text-[#3d74ff]"}`}>
        {kicker}
      </div>
      <h2 className={`mt-2 text-xl font-semibold ${dark ? "text-white" : "text-slate-900"}`}>{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[16px] bg-[#fbfbfc] px-4 py-6 text-center text-sm text-slate-400">{children}</div>;
}
