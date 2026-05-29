# A2A orchestration UI

This UI adds a dedicated `/orchestration` page for visualizing an A2A-style multi-agent run without changing the existing news/feed contract.

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

## Integration path

The current page uses `src/lib/mock/a2a-orchestration.ts`. To attach a real A2A host:

1. Add a route such as `GET /api/a2a/runs/:id` for the durable task snapshot.
2. Add a streaming route that proxies `message/stream` or `tasks/subscribe` events into the event timeline.
3. Validate AgentCard, message, and artifact schemas server-side before exposing them to the UI or LLM context.
4. Keep the news page contract unchanged: `/api/feed`, `/api/briefing`, and `/api/chat` continue to serve the existing dashboard.
