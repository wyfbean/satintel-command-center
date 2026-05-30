# A2A orchestration UI

> **Superseded.** `/orchestration` has been rebuilt as a ChatGPT-style chat for a CrewAI
> multi-agent backend (MCP/A2A tool-call results rendered inline) — see
> [agent-backend-crewai.md](agent-backend-crewai.md). This document is retained for the original
> AG-UI design rationale and the A2A integration notes below.

This UI originally added a dedicated `/orchestration` page for visualizing an A2A-style multi-agent run without changing the existing news/feed contract.

## UI scheme

- AgentCard registry: shows each agent endpoint, capability flags, modalities, role, skills, and trust boundary.
- Workflow graph: shows Agent0 host orchestration across source ingestion, geo evidence, risk review, and final briefing.
- Task event timeline: shows task state updates, messages, artifact updates, and recovery snapshots in order.
- Debug console: exposes the selected event payload so engineers can map the UI to JSON-RPC or stream events.
- Artifact/result panel: separates intermediate artifacts from the final operator-facing result.

## Sources used for the scheme

- `a2aproject/a2a-samples`: official samples and related repositories list, including `a2a-inspector`.
- `a2aproject/a2a-inspector`: uses Agent Card display, live interaction, compliance checks, and a raw debug console.
- A2A task documentation: treats `Task` as the stateful work unit and includes history plus artifacts.
- A2A streaming documentation: models low-latency task updates through stream events and uses `tasks/get` for recovery.
- A2A core specification notes: separates `Message` as interaction payload from `Artifact` as output payload.

## Current implementation: AG-UI + CopilotKit (rebuilt)

The static page has been replaced by an AG-UI conversational view (CopilotKit). The flow:

- `OrchestrationMockAgent` (`src/lib/a2a/orchestration-agent.ts`) replays
  `src/lib/mock/a2a-orchestration.ts` as a spec-compliant AG-UI event stream
  (`RUN_STARTED → STEP/TEXT_MESSAGE/TOOL_CALL/STATE_SNAPSHOT → RUN_FINISHED`).
- It is registered in `CopilotRuntime` at `src/app/api/copilotkit/route.ts` and bound on the
  page via `<CopilotKit agent="orchestration">`.
- `src/components/orchestration/orchestration-shell.tsx` renders three channels:
  `TEXT_MESSAGE_*` → chat bubbles, `TOOL_CALL_*` → A2A state-call cards
  (`useCopilotAction` catch-all), `STATE_SNAPSHOT` → `useCoAgent` state panels.

See [copilotkit-dashboard.md](copilotkit-dashboard.md) for the shared runtime details.

## Integration path (mock → real A2A host)

**The single swap point is `OrchestrationMockAgent`.** To attach a real A2A host:

1. Replace the replay agent with `@ag-ui/a2a-middleware` (a bridge that wraps an A2A
   endpoint and emits AG-UI events), or an `HttpAgent` pointing at an AG-UI proxy.
2. The proxy translates A2A `message/stream` / `tasks/subscribe` into AG-UI events and uses
   `tasks/get` for recovery snapshots.
3. Validate AgentCard, message, and artifact schemas server-side before exposing them to the
   UI or LLM context.
4. Keep the news page contract unchanged: `/api/feed`, `/api/briefing`, and `/api/chat`
   continue to serve the existing dashboard. The UI (event shapes, `useCoAgent` state) does
   not change when the mock agent is swapped for the real bridge.
