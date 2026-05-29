import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

import { mockA2AOrchestrationRun } from "@/lib/mock/a2a-orchestration";
import type { A2AOrchestrationRun } from "@/types/a2a";

/**
 * OrchestrationMockAgent is the A2A → AG-UI bridge for this phase.
 *
 * It replays the canned {@link mockA2AOrchestrationRun} as a spec-compliant AG-UI
 * event stream so the `/orchestration` page can render it with CopilotKit exactly
 * as it will render a real A2A host later. The single swap point for production is
 * this class: replace the replay with `@ag-ui/a2a-middleware` pointed at a live
 * A2A endpoint (see docs/a2a-orchestration-ui.md) and the UI does not change.
 *
 * Event ordering follows the AG-UI contract enforced by `verifyEvents`:
 *   RUN_STARTED
 *     STATE_SNAPSHOT (initial)
 *     ( STEP_STARTED
 *       TEXT_MESSAGE_START → CONTENT → END        // narration → chat bubble
 *       [ TOOL_CALL_START → ARGS → END ]          // A2A "state call" → render card
 *       STATE_SNAPSHOT                            // progressive co-agent state
 *       STEP_FINISHED )*
 *     STATE_SNAPSHOT (final)
 *     TEXT_MESSAGE_START → CONTENT → END          // closing summary
 *   RUN_FINISHED
 *
 * No LLM is involved, so this works with zero environment variables.
 */
export class OrchestrationMockAgent extends AbstractAgent {
  /** Delay between emitted events (ms) to give the UI a live streaming feel. */
  private readonly stepDelayMs = 320;

  run(input: RunAgentInput): Observable<BaseEvent> {
    const sequence = buildEventSequence(input, mockA2AOrchestrationRun);

    return new Observable<BaseEvent>((subscriber) => {
      let cancelled = false;
      let index = 0;
      const timers: ReturnType<typeof setTimeout>[] = [];

      const emitNext = () => {
        if (cancelled) return;
        if (index >= sequence.length) {
          subscriber.complete();
          return;
        }
        subscriber.next(sequence[index]);
        index += 1;
        // RUN_STARTED + initial snapshot fire immediately; the rest stream.
        const delay = index <= 2 ? 0 : this.stepDelayMs;
        timers.push(setTimeout(emitNext, delay));
      };

      emitNext();

      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
      };
    });
  }
}

/** Shape the `/orchestration` page reads via `useCoAgent`. */
export type OrchestrationAgentState = {
  goal: string;
  sessionId: string;
  statusMessage: string;
  taskState: A2AOrchestrationRun["taskState"];
  agents: A2AOrchestrationRun["agents"];
  edges: A2AOrchestrationRun["edges"];
  workflow: A2AOrchestrationRun["workflow"];
  timeline: A2AOrchestrationRun["events"];
  artifacts: A2AOrchestrationRun["artifacts"];
  finalResult: A2AOrchestrationRun["finalResult"] | null;
  metrics: A2AOrchestrationRun["metrics"];
};

/** AG-UI event-type → A2A JSON-RPC method label surfaced on the tool-call card. */
const toolCallNameByEventType: Record<A2AOrchestrationRun["events"][number]["eventType"], string> = {
  "agent-card": "agent/getAuthenticatedExtendedCard",
  "send-message": "message/stream",
  "status-update": "tasks/status",
  "artifact-update": "tasks/artifact",
  "task-get": "tasks/get",
};

function buildEventSequence(input: RunAgentInput, run: A2AOrchestrationRun): BaseEvent[] {
  const { threadId, runId } = input;
  const events: BaseEvent[] = [];
  const agentName = (agentId: string) => run.agents.find((a) => a.id === agentId)?.name ?? agentId;

  // Progressive state, snapshotted after every timeline event.
  const revealedArtifacts: A2AOrchestrationRun["artifacts"] = [];
  const timeline: A2AOrchestrationRun["events"] = [];
  const workflow: A2AOrchestrationRun["workflow"] = run.workflow.map((step) => ({
    ...step,
    taskState: "submitted",
  }));

  const snapshot = (taskState: OrchestrationAgentState["taskState"], statusMessage: string): OrchestrationAgentState => ({
    goal: run.goal,
    sessionId: run.sessionId,
    statusMessage,
    taskState,
    agents: run.agents,
    edges: run.edges,
    workflow: workflow.map((step) => ({ ...step })),
    timeline: timeline.map((event) => ({ ...event })),
    artifacts: revealedArtifacts.map((artifact) => ({ ...artifact })),
    finalResult: taskState === "completed" ? run.finalResult : null,
    metrics: {
      ...run.metrics,
      taskUpdates: timeline.length,
      artifacts: revealedArtifacts.length,
    },
  });

  events.push({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);
  events.push({ type: EventType.STATE_SNAPSHOT, snapshot: snapshot("submitted", "Host Agent 正在发现远端 AgentCard。") } as BaseEvent);

  run.events.forEach((event, position) => {
    const stepName = `${agentName(event.agentId)} · ${event.title}`;
    events.push({ type: EventType.STEP_STARTED, stepName } as BaseEvent);

    // Narration → chat bubble.
    const messageId = `msg-${event.id}`;
    events.push({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
    events.push({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: `【${agentName(event.agentId)}】${event.detail}`,
    } as BaseEvent);
    events.push({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);

    // A2A "state call" → rendered tool-call card.
    const toolCallId = `call-${event.id}`;
    events.push({
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: toolCallNameByEventType[event.eventType],
      parentMessageId: messageId,
    } as BaseEvent);
    events.push({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: JSON.stringify({ agentId: event.agentId, eventType: event.eventType, ...event.payload }),
    } as BaseEvent);
    events.push({ type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent);

    // Advance progressive state: live step status, timeline, artifacts.
    const matchedStep = workflow.find((step) => step.agentId === event.agentId);
    if (matchedStep) matchedStep.taskState = event.state;
    timeline.push(event);
    const artifactId = typeof event.payload.artifactId === "string" ? event.payload.artifactId : undefined;
    if (artifactId) {
      const artifact = run.artifacts.find((candidate) => candidate.id === artifactId);
      if (artifact && !revealedArtifacts.some((existing) => existing.id === artifact.id)) {
        revealedArtifacts.push(artifact);
      }
    }

    const isLast = position === run.events.length - 1;
    events.push({
      type: EventType.STATE_SNAPSHOT,
      snapshot: snapshot(isLast ? "working" : event.state === "completed" ? "working" : event.state, event.title),
    } as BaseEvent);
    events.push({ type: EventType.STEP_FINISHED, stepName } as BaseEvent);
  });

  // Final state: surface every artifact and the operator briefing.
  for (const artifact of run.artifacts) {
    if (!revealedArtifacts.some((existing) => existing.id === artifact.id)) revealedArtifacts.push(artifact);
  }
  for (const step of workflow) step.taskState = "completed";
  events.push({ type: EventType.STATE_SNAPSHOT, snapshot: snapshot("completed", run.statusMessage) } as BaseEvent);

  const summaryId = "msg-final";
  events.push({ type: EventType.TEXT_MESSAGE_START, messageId: summaryId, role: "assistant" } as BaseEvent);
  events.push({
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: summaryId,
    delta: `${run.finalResult.title}\n\n${run.finalResult.summary}`,
  } as BaseEvent);
  events.push({ type: EventType.TEXT_MESSAGE_END, messageId: summaryId } as BaseEvent);

  events.push({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);

  return events;
}
