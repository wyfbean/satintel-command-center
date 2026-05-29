"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type {
  A2AAgentCard,
  A2AEvent,
  A2AOrchestrationRun,
  A2ATaskState,
  A2AWorkflowStep,
} from "@/types/a2a";

type OrchestrationShellProps = {
  run: A2AOrchestrationRun;
};

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

const roleLabel: Record<A2AAgentCard["role"], string> = {
  host: "Host",
  remote: "Remote",
  observer: "Observer",
};

function formatTime(isoString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(isoString));
}

function formatDateTime(isoString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoString));
}

function stateClass(state: A2ATaskState) {
  return taskStateTone[state];
}

function getAgentName(agents: A2AAgentCard[], agentId: string) {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function AgentCard({
  agent,
  active,
  onSelect,
}: {
  agent: A2AAgentCard;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-[24px] border p-4 text-left transition ${
        active
          ? "border-[#b9ccff] bg-[#f4f7ff] shadow-[0_12px_28px_rgba(61,116,255,0.12)]"
          : "border-[#ebedf2] bg-white hover:border-[#cfdcff]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{agent.name}</div>
          <div className="mt-1 text-xs text-slate-400">{agent.endpoint}</div>
        </div>
        <span className="rounded-full border border-[#dbe4ff] bg-white px-2.5 py-1 text-xs font-medium text-[#3d74ff]">
          {roleLabel[agent.role]}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {agent.skills.slice(0, 3).map((skill) => (
          <span key={skill} className="rounded-full bg-[#f6f8fb] px-2.5 py-1 text-xs text-slate-500">
            {skill}
          </span>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-500">
        <div className="rounded-[16px] bg-[#fbfbfc] px-3 py-2">
          streaming <span className="font-semibold text-slate-800">{agent.capabilities.streaming ? "on" : "off"}</span>
        </div>
        <div className="rounded-[16px] bg-[#fbfbfc] px-3 py-2">
          push <span className="font-semibold text-slate-800">{agent.capabilities.pushNotifications ? "on" : "off"}</span>
        </div>
      </div>
    </button>
  );
}

function WorkflowNode({
  step,
  agent,
  active,
  onSelect,
}: {
  step: A2AWorkflowStep;
  agent?: A2AAgentCard;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative z-10 flex min-h-[178px] w-full flex-col justify-between rounded-[26px] border p-4 text-left transition ${
        active
          ? "border-[#3d74ff] bg-white shadow-[0_20px_44px_rgba(61,116,255,0.16)]"
          : "border-[#e3e9f6] bg-white/90 hover:border-[#b9ccff]"
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-3">
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${stateClass(step.taskState)}`}>
            {taskStateLabel[step.taskState]}
          </span>
          <span className="font-mono text-xs text-slate-400">{step.latencyMs}ms</span>
        </div>
        <h3 className="mt-4 text-xl font-semibold leading-7 text-slate-900">{step.title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">{step.subtitle}</p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#eff2f7] pt-3 text-xs text-slate-400">
        <span>{agent?.name ?? step.agentId}</span>
        <span>{step.artifactCount} artifacts</span>
      </div>
    </button>
  );
}

function EventRow({
  event,
  active,
  agentName,
  onSelect,
}: {
  event: A2AEvent;
  active: boolean;
  agentName: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full grid-cols-[72px_1fr] gap-4 rounded-[22px] border p-4 text-left transition ${
        active ? "border-[#b9ccff] bg-[#f6f8ff]" : "border-[#ebedf2] bg-white hover:border-[#cfdcff]"
      }`}
    >
      <div className="font-mono text-xs text-slate-400">{formatTime(event.timestamp)}</div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{event.title}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${stateClass(event.state)}`}>
            {taskStateLabel[event.state]}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-500">{event.detail}</p>
        <div className="mt-3 text-xs text-[#3d74ff]">{agentName}</div>
      </div>
    </button>
  );
}

function JsonConsole({ event }: { event: A2AEvent }) {
  const json = JSON.stringify(
    {
      id: event.id,
      agentId: event.agentId,
      eventType: event.eventType,
      state: event.state,
      payload: event.payload,
    },
    null,
    2,
  );

  return (
    <pre className="scrollbar-thin max-h-[420px] overflow-auto rounded-[24px] bg-[#111827] p-5 text-xs leading-6 text-[#dbeafe] shadow-[0_18px_40px_rgba(17,24,39,0.16)]">
      <code>{json}</code>
    </pre>
  );
}

export function OrchestrationShell({ run }: OrchestrationShellProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(run.agents[0]?.id ?? "");
  const [selectedStepId, setSelectedStepId] = useState(run.workflow[0]?.id ?? "");
  const [selectedEventId, setSelectedEventId] = useState(run.events[0]?.id ?? "");
  const selectedAgent = run.agents.find((agent) => agent.id === selectedAgentId) ?? run.agents[0];
  const selectedStep = run.workflow.find((step) => step.id === selectedStepId) ?? run.workflow[0];
  const selectedEvent = run.events.find((event) => event.id === selectedEventId) ?? run.events[0];
  const selectedArtifacts = useMemo(
    () => run.artifacts.filter((artifact) => artifact.ownerAgentId === selectedAgent?.id),
    [run.artifacts, selectedAgent?.id],
  );

  function selectStep(step: A2AWorkflowStep) {
    setSelectedStepId(step.id);
    setSelectedAgentId(step.agentId);
    const eventForAgent = run.events.find((event) => event.agentId === step.agentId);

    if (eventForAgent) {
      setSelectedEventId(eventForAgent.id);
    }
  }

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
                <div className="text-sm font-semibold text-slate-900">卫星情报多智能体编排</div>
                <div className="text-xs text-slate-400">Agent0 orchestration · task stream · artifact result</div>
              </div>
            </div>

            <nav className="flex flex-wrap items-center gap-3 text-sm">
              <Link href="/" className="rounded-full border border-[#e8ebf0] bg-white px-4 py-2 text-slate-600">
                资讯流
              </Link>
              <span className="rounded-full bg-[#1f2430] px-4 py-2 font-medium text-white">Agent 编排</span>
            </nav>
          </div>

          <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="status-dot live" />
                <span className={`rounded-full border px-3 py-1 text-sm font-medium ${stateClass(run.taskState)}`}>
                  {taskStateLabel[run.taskState]}
                </span>
                <span className="text-sm text-slate-400">更新于 {formatDateTime(run.updatedAt)}</span>
              </div>
              <h1 className="mt-5 max-w-5xl text-4xl font-semibold leading-tight text-slate-950 md:text-6xl">
                可解释的 A2A 协作流程与最终产出
              </h1>
              <p className="mt-4 max-w-4xl text-[17px] leading-8 text-slate-500">{run.goal}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[22px] border border-[#ebedf2] bg-[#fafbff] p-4">
                <div className="text-xs text-slate-400">Agents</div>
                <div className="mt-2 text-3xl font-semibold text-slate-900">{run.metrics.activeAgents}</div>
              </div>
              <div className="rounded-[22px] border border-[#ebedf2] bg-[#f8fffb] p-4">
                <div className="text-xs text-slate-400">Artifacts</div>
                <div className="mt-2 text-3xl font-semibold text-[#15803d]">{run.metrics.artifacts}</div>
              </div>
              <div className="rounded-[22px] border border-[#ebedf2] bg-[#fffaf0] p-4">
                <div className="text-xs text-slate-400">Task updates</div>
                <div className="mt-2 text-3xl font-semibold text-[#b7791f]">{run.metrics.taskUpdates}</div>
              </div>
              <div className="rounded-[22px] border border-[#ebedf2] bg-[#fbfbfc] p-4">
                <div className="text-xs text-slate-400">Mean latency</div>
                <div className="mt-2 text-3xl font-semibold text-slate-900">{run.metrics.meanLatencyMs}ms</div>
              </div>
            </div>
          </section>
        </header>

        <section className="grid items-start gap-6 xl:grid-cols-[330px_minmax(0,1fr)_380px]">
          <aside className="space-y-5 xl:sticky xl:top-6">
            <section className="rounded-[30px] border border-[#ebedf2] bg-white p-5 shadow-[0_14px_34px_rgba(28,42,71,0.06)]">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">AgentCard Registry</div>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">能力与信任边界</h2>
              <div className="mt-5 space-y-3">
                {run.agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    active={agent.id === selectedAgent?.id}
                    onSelect={() => setSelectedAgentId(agent.id)}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-[30px] border border-[#ebedf2] bg-white p-5">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">Selected Agent</div>
              <h3 className="mt-2 text-xl font-semibold text-slate-900">{selectedAgent?.name}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-500">{selectedAgent?.trustBoundary}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedAgent?.capabilities.modalities.map((mode) => (
                  <span key={mode} className="rounded-full bg-[#f4f7ff] px-3 py-1 text-xs text-[#3d74ff]">
                    {mode}
                  </span>
                ))}
              </div>
              {selectedArtifacts.length > 0 ? (
                <div className="mt-5 space-y-2">
                  {selectedArtifacts.map((artifact) => (
                    <div key={artifact.id} className="rounded-[18px] bg-[#fbfbfc] px-4 py-3 text-sm text-slate-600">
                      {artifact.title}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-[18px] bg-[#fbfbfc] px-4 py-3 text-sm text-slate-400">
                  该 Agent 当前没有直接产出的 artifact。
                </div>
              )}
            </section>
          </aside>

          <section className="min-w-0 space-y-6">
            <section className="rounded-[34px] border border-[#ebedf2] bg-white p-6 shadow-[0_14px_34px_rgba(28,42,71,0.06)]">
              <div className="flex flex-col gap-4 border-b border-[#eff1f4] pb-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">A2A Workflow Graph</div>
                  <h2 className="mt-2 text-3xl font-semibold text-slate-900">Agent0 编排拓扑</h2>
                </div>
                <div className="rounded-full bg-[#f4f7ff] px-4 py-2 text-sm text-[#3d74ff]">{run.sessionId}</div>
              </div>

              <div className="relative mt-6">
                <div className="absolute left-6 right-6 top-[88px] hidden h-px bg-[#d8e3ff] lg:block" />
                <div className="grid gap-4 lg:grid-cols-5">
                  {run.workflow.map((step) => (
                    <WorkflowNode
                      key={step.id}
                      step={step}
                      agent={run.agents.find((agent) => agent.id === step.agentId)}
                      active={step.id === selectedStep?.id}
                      onSelect={() => selectStep(step)}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {run.edges.map((edge) => (
                  <div key={edge.id} className="rounded-[20px] border border-[#ebedf2] bg-[#fbfcff] p-4">
                    <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                      <span>
                        {getAgentName(run.agents, edge.from)}
                        {" -> "}
                        {getAgentName(run.agents, edge.to)}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[#3d74ff]">{edge.transport}</span>
                    </div>
                    <div className="mt-3 text-sm font-medium text-slate-700">{edge.label}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="rounded-[34px] border border-[#ebedf2] bg-white p-6 shadow-[0_14px_34px_rgba(28,42,71,0.06)]">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">Task Event Timeline</div>
                <h2 className="mt-2 text-3xl font-semibold text-slate-900">状态、消息与 artifact 更新</h2>
                <div className="mt-5 space-y-3">
                  {run.events.map((event) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      active={event.id === selectedEvent?.id}
                      agentName={getAgentName(run.agents, event.agentId)}
                      onSelect={() => {
                        setSelectedEventId(event.id);
                        setSelectedAgentId(event.agentId);
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-[34px] border border-[#ebedf2] bg-white p-6 shadow-[0_14px_34px_rgba(28,42,71,0.06)]">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">Debug Console</div>
                <h2 className="mt-2 text-3xl font-semibold text-slate-900">事件载荷</h2>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  保留 JSON-RPC / stream 视角，便于把前端 mock 替换成真实 A2A Host 的任务事件。
                </p>
                <div className="mt-5">
                  <JsonConsole event={selectedEvent} />
                </div>
              </div>
            </section>
          </section>

          <aside className="space-y-5 xl:sticky xl:top-6">
            <section className="rounded-[30px] border border-[#ebedf2] bg-[#111827] p-5 text-white shadow-[0_18px_42px_rgba(17,24,39,0.18)]">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#93c5fd]">Final Result</div>
              <h2 className="mt-3 text-2xl font-semibold leading-8">{run.finalResult.title}</h2>
              <p className="mt-4 text-sm leading-7 text-slate-300">{run.finalResult.summary}</p>
              <div className="mt-5 rounded-[22px] bg-white/8 p-4">
                <div className="text-sm font-semibold text-white">当前状态</div>
                <p className="mt-2 text-sm leading-6 text-slate-300">{run.statusMessage}</p>
              </div>
            </section>

            <section className="rounded-[30px] border border-[#ebedf2] bg-white p-5 shadow-[0_14px_34px_rgba(28,42,71,0.06)]">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">Artifacts</div>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900">交付物栈</h3>
              <div className="mt-5 space-y-3">
                {run.artifacts.map((artifact) => (
                  <article key={artifact.id} className="rounded-[22px] border border-[#ebedf2] bg-[#fbfbfc] p-4">
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
            </section>

            <section className="rounded-[30px] border border-[#ebedf2] bg-white p-5 shadow-[0_14px_34px_rgba(28,42,71,0.06)]">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">Decisions</div>
              <div className="mt-4 space-y-3">
                {run.finalResult.decisions.map((decision) => (
                  <div key={decision} className="rounded-[18px] bg-[#f7f9ff] px-4 py-3 text-sm leading-6 text-slate-600">
                    {decision}
                  </div>
                ))}
              </div>
              <div className="mt-5 border-t border-[#eff1f4] pt-5">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Next Actions</div>
                <div className="mt-3 space-y-2">
                  {run.finalResult.nextActions.map((action) => (
                    <div key={action} className="text-sm leading-6 text-slate-600">
                      {action}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
