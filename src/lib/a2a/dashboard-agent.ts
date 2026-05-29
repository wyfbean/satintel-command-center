import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

import { generateChatAnswer } from "@/lib/intel/llm";
import { getDashboardData } from "@/lib/intel/service";
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
        emit({ type: EventType.STATE_SNAPSHOT, snapshot: toDashboardSnapshot(dashboard) } as BaseEvent);

        const messages = extractChatMessages(input);
        const hasQuestion = messages.some((message) => message.role === "user");

        const messageId = `msg-${runId}`;
        emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);

        if (!hasQuestion) {
          emit({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId,
            delta: buildWelcome(dashboard),
          } as BaseEvent);
        } else {
          const answer = await generateChatAnswer({
            messages,
            contextItems: dashboard.items.slice(0, 5),
            missionContext: "卫星情报对话面板",
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
};

function toDashboardSnapshot(dashboard: DashboardData): DashboardAgentState {
  return {
    generatedAt: dashboard.generatedAt,
    llmConfigured: dashboard.sourceSummary.llmConfigured,
    items: dashboard.items.slice(0, 12),
    trends: dashboard.trends,
    sourceSummary: dashboard.sourceSummary,
    briefing: dashboard.briefing,
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

function extractChatMessages(input: RunAgentInput): ChatMessage[] {
  return (input.messages ?? [])
    .filter(
      (message): message is typeof message & { content: string } =>
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
    )
    .map((message) => ({ role: message.role as ChatMessage["role"], content: message.content }));
}
