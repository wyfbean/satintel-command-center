# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev      # next dev — http://localhost:3000
npm run build    # next build (production verification)
npm run lint     # eslint via eslint-config-next
npm start        # next start (after build)
```

There is no test runner configured; Phase 5 acceptance in `docs/system-blueprint.md` relies on `build`, `lint`, and manual flow checks (feed refresh, Ask AI, orchestration view).

## Environment

UI works with zero env vars (falls back to seeded data and heuristic summaries). Live LLM + ingestion requires `.env.local`:

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://your-compatible-endpoint/v1
OPENAI_MODEL=your-model-name        # defaults to gpt-4o-mini
SATINTEL_RSS_SOURCES=url1,url2      # comma-separated; defaults to SpaceNews + NASA
SATINTEL_CRAWL_URLS=url1,url2       # generic public HTML pages
SATINTEL_WECHAT_URLS=url1,url2      # legacy alias; used as crawl fallback
NEXT_PUBLIC_FEED_MODE=mock          # force dashboard to render frontendMockDashboardData
```

`OPENAI_API_KEY` is the gate: when unset, `getClient()` in `src/lib/intel/llm.ts` returns `null` and every LLM call routes to deterministic Chinese fallback strings — keep that path working when editing.

## Architecture

Next.js 16 App Router (React 19, Tailwind v4). Four pages share one backend:

- `/` → `DashboardShell` (Chinese news feed + Ask AI), data from `getDashboardData()`.
- `/orchestration` → `OrchestrationShell` — AG-UI conversational view of the A2A run (CopilotKit), driven by `OrchestrationMockAgent` replaying `src/lib/mock/a2a-orchestration.ts`.
- `/dashboard` → `DashboardCopilotShell` — CopilotKit conversational dashboard over the feed, driven by `SatelliteDashboardAgent`.
- `/globe` → `GlobeShell` — 3D flagship-satellite map (react-globe.gl + satellite.js), data from `src/lib/satellites/catalog.ts`.

### AG-UI / CopilotKit layer (`src/lib/a2a/`, `src/app/api/copilotkit/`)

`/orchestration` and `/dashboard` share the CopilotKit runtime at `src/app/api/copilotkit/route.ts`. Agents are in-process AG-UI `AbstractAgent`s registered in `CopilotRuntime({ agents })`; the serviceAdapter is `ExperimentalEmptyAdapter` (agents emit their own events, so **no LLM key is needed at the runtime level** — keep this invariant). Bind a page to an agent via `<CopilotKit agent="orchestration|satellite_dashboard">`. The A2A→AG-UI bridge (`OrchestrationMockAgent`) is the single swap point for a real A2A host — see `docs/a2a-orchestration-ui.md`. `SatelliteDashboardAgent` reuses `getDashboardData` + `generateChatAnswer` (preserving the deterministic fallback).

### Ingestion pipeline (`src/lib/intel/`)

The mock-backend facade in `src/lib/backend/mock-backend.ts` is the seam meant to be swapped for a real backend later. It dispatches to one adapter per `SourceKind`:

```
sourceCatalog (catalog.ts)
  → adapterRegistry { mock | rss | crawl | wechat-url }   (mock-backend.ts)
  → RawIntelRecord[]                                       (types/intel.ts)
  → dedupeAndRank + toIntelItem                            (scoring.ts)
  → enrichItemSummary (top 8) + generateBriefing           (llm.ts)
  → DashboardData                                          (service.ts)
```

Key invariants:

- All adapters normalize to the same `RawIntelRecord` shape, so the UI never knows whether an item came from RSS, HTML crawl, WeChat URL, or seed data.
- Scoring is `freshness*0.3 + relevance*0.42 + urgency*0.28`, keyword-driven (`relevanceKeywords` / `urgencyKeywords` in `scoring.ts`). Dedupe key is `title.toLowerCase()::url`.
- LLM enrichment runs only on the top 8 ranked items to cap token spend; the rest keep heuristic `summary` / `whyItMatters`.
- `CrawlAdapter` policy is intentionally conservative — fetch only explicitly configured public URLs, no login or anti-bot bypass. Preserve this when extending crawlers.

### HTTP contracts (`src/app/api/`)

The UI contract is stable and should not change without updating both `DashboardShell` and the mock backend overview:

- `GET /api/feed` → `DashboardData`
- `GET /api/briefing` → `{ briefing: BriefingSection[] }`
- `POST /api/chat` → `{ answer: string }`, body `{ messages, selectedIds, missionContext }`. When `selectedIds` is empty, the top 3 ranked items are used as grounding.
- `GET /api/backend/overview` and `POST /api/backend/crawl` are inspection-only endpoints for the mock-backend facade.

### Dashboard shell behavior (`src/components/dashboard/dashboard-shell.tsx`)

- Setting `NEXT_PUBLIC_FEED_MODE=mock` bypasses server data and renders `frontendMockDashboardData` — used to debug scroll/selection/Ask AI without ingestion.
- Scroll position drives `selectedId` via a viewport-anchor measurement; the right-side detail/briefing/chat panels follow scroll, not clicks alone. When changing feed layout, keep `feedNodeMap` registration intact or scroll-sync will break.

### A2A orchestration (`/orchestration`)

Currently fed by `src/lib/mock/a2a-orchestration.ts`. Per `docs/a2a-orchestration-ui.md`, the planned real integration is `GET /api/a2a/runs/:id` plus a streaming proxy for `message/stream` / `tasks/subscribe`. Schema-validate AgentCard, message, and artifact payloads server-side before passing them to the UI or LLM context. The news contract (`/api/feed`, `/api/briefing`, `/api/chat`) must remain unchanged when wiring this up.

## Conventions

- Path alias: `@/*` → `src/*` (see `tsconfig.json`).
- User-facing copy in the dashboard, briefing prompts, and Chinese fallback strings is `zh-CN`. LLM system prompts in `llm.ts` enforce Chinese output and a strict line/section format (`SUMMARY:` / `WHY:` / `SECTION: heading :: body`) — the parser depends on these markers, so don't reword them casually.
- New source types: add a `SourceKind` in `types/intel.ts`, implement `SourceAdapter`, register in `adapterRegistry`, and add entries to `sourceCatalog`. Nothing else in the pipeline should need to change.
