import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

import { generateChatAnswer } from "@/lib/intel/llm";
import { getDashboardData } from "@/lib/intel/service";
import { extractTrendSignals } from "@/lib/intel/scoring";
import type { ChatMessage, DashboardData } from "@/types/intel";

/**
 * SatelliteDashboardAgent powers the conversational `/dashboard`.
 *
 * It is an in-process AG-UI agent that reuses the existing intelligence service:
 * {@link getDashboardData} for grounding context and {@link generateChatAnswer} for
 * the reply (which already degrades to a deterministic Chinese answer when
 * `OPENAI_API_KEY` is unset). On every run it publishes the current feed as a
 * STATE_SNAPSHOT so the page can render live domain panels alongside the chat.
 */
export class SatelliteDashboardAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    const { threadId, runId } = input;

    return new Observable<BaseEvent>((subscriber) => {
      let cancelled = false;

      const emit = (event: BaseEvent) => {
        if (!cancelled) subscriber.next(event);
      };

      (async () => {
        emit({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);

        const dashboard = await getDashboardData();
        const messages = extractChatMessages(input);
        const latestUser = [...messages].reverse().find((message) => message.role === "user");

        // Resolve the active source filter from the latest message, preserving
        // any prior filter (carried in the agent state) when the user neither
        // names a new source nor asks to reset.
        const priorState = input.state as DashboardAgentState | undefined;
        const appliedSource = resolveFilter(dashboard, latestUser?.content, priorState?.appliedSource ?? null);

        // The snapshot reflects the filter, so the top dashboard (KPIs / trends /
        // briefing) is genuinely chat-driven — not just the feed below it.
        const view = appliedSource ? filterDashboard(dashboard, appliedSource) : dashboard;
        emit({ type: EventType.STATE_SNAPSHOT, snapshot: toDashboardSnapshot(view, appliedSource) } as BaseEvent);

        // Keep the feed below in sync via the `filterBySource` frontend action
        // (CopilotKit frontend-action loop). Emitted every run so the feed and
        // the hero never drift apart.
        const hasFilterTool = (input.tools ?? []).some((tool) => tool.name === "filterBySource");
        if (hasFilterTool) {
          const toolCallId = `call-filter-${runId}`;
          emit({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: "filterBySource" } as BaseEvent);
          emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify({ source: appliedSource ?? "全部" }) } as BaseEvent);
          emit({ type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent);
        }

        const messageId = `msg-${runId}`;
        emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);

        if (!latestUser) {
          emit({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId,
            delta: buildWelcome(dashboard),
          } as BaseEvent);
        } else {
          // Frontend `useCopilotReadable` context grounds the answer in what the
          // operator currently sees (active filter, selected item).
          const frontendContext = (input.context ?? [])
            .map((entry) => `${entry.description}: ${entry.value}`)
            .join("\n");
          const answer = await generateChatAnswer({
            messages,
            contextItems: dashboard.items.slice(0, 5),
            missionContext: `卫星情报对话面板${frontendContext ? `\n界面上下文：\n${frontendContext}` : ""}`,
          });
          emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: answer } as BaseEvent);
        }

        emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
        emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);

        if (!cancelled) subscriber.complete();
      })().catch((error) => {
        if (!cancelled) subscriber.error(error);
      });

      return () => {
        cancelled = true;
      };
    });
  }
}

/** State the `/dashboard` page reads via `useCoAgent` to render live domain panels. */
export type DashboardAgentState = {
  generatedAt: string;
  llmConfigured: boolean;
  items: DashboardData["items"];
  trends: DashboardData["trends"];
  sourceSummary: DashboardData["sourceSummary"];
  briefing: DashboardData["briefing"];
  /** Source filter currently applied by chat (null = all sources). */
  appliedSource: string | null;
};

function toDashboardSnapshot(dashboard: DashboardData, appliedSource: string | null = null): DashboardAgentState {
  return {
    generatedAt: dashboard.generatedAt,
    llmConfigured: dashboard.sourceSummary.llmConfigured,
    items: dashboard.items.slice(0, 12),
    trends: dashboard.trends,
    sourceSummary: dashboard.sourceSummary,
    briefing: dashboard.briefing,
    appliedSource,
  };
}

const RESET_RE = /全部|所有|重置|清除|取消筛选|reset|clear|^all$/i;

/**
 * Decide the source filter for this turn: a newly named source wins; an
 * explicit reset clears it; otherwise the prior filter is preserved so that
 * unrelated follow-up questions don't silently drop the active view.
 */
function resolveFilter(dashboard: DashboardData, message: string | undefined, prior: string | null): string | null {
  if (!message) return prior;
  const named = matchSource(dashboard, message);
  if (named) return named;
  if (RESET_RE.test(message)) return null;
  return prior;
}

/** Narrow the dashboard to a single source and recompute the derived signals. */
function filterDashboard(dashboard: DashboardData, source: string): DashboardData {
  const items = dashboard.items.filter((item) => item.sourceName === source);
  return {
    ...dashboard,
    items,
    trends: extractTrendSignals(items),
    sourceSummary: {
      ...dashboard.sourceSummary,
      totalItems: items.length,
      liveSources: items.length ? 1 : 0,
    },
  };
}

function buildWelcome(dashboard: DashboardData): string {
  const top = dashboard.items.slice(0, 3).map((item) => item.title);
  return [
    "你好，我是卫星情报对话面板助手。",
    `当前资讯流共 ${dashboard.items.length} 条信号，优先级最高的是：${top.join("、")}。`,
    "你可以问我某个来源、地区或主题的动态，我会基于当前资讯流回答。",
  ].join("\n");
}

/** Find a feed source name mentioned in the user's message, if any. */
function matchSource(dashboard: DashboardData, text: string): string | null {
  const names = Array.from(new Set(dashboard.items.map((item) => item.sourceName)));
  return names.find((name) => name && text.includes(name)) ?? null;
}

function extractChatMessages(input: RunAgentInput): ChatMessage[] {
  return (input.messages ?? [])
    .filter(
      (message): message is typeof message & { content: string } =>
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
    )
    .map((message) => ({ role: message.role as ChatMessage["role"], content: message.content }));
}
