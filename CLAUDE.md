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

The `/orchestration` chat needs the Python CrewAI agent backend (`backend/`):

```bash
cd backend && uv sync
uv run uvicorn app:app --host 127.0.0.1 --port 8000 --reload   # AG-UI POST /agent
```

It runs in deterministic **mock mode** with zero env vars (still exercises the bundled satellite MCP tools); set `OPENAI_API_KEY` in `backend/.env` for the real CrewAI crew. See `docs/agent-backend-crewai.md`.

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
- `/orchestration` → `OrchestrationShell` — ChatGPT-style single-window `CopilotChat` bound to a **CrewAI** multi-agent backend over AG-UI (`HttpAgent` → Python FastAPI at `AGENT_BACKEND_URL`, default `http://127.0.0.1:8000/agent`). Multi-agent collaboration + MCP/A2A tool-call results render inline; supports satellite-image upload (VQA/segmentation). Requires the `backend/` service running (see `docs/agent-backend-crewai.md`); shows an offline banner otherwise.
- `/dashboard` → `DashboardCopilotShell` — CopilotKit conversational dashboard; chat (right) + data panels from `/api/feed` (left), driven by `SatelliteDashboardAgent`. Headings are data-source-agnostic.
- `/globe` → `GlobeShell` — 3D flagship-satellite map (react-globe.gl + satellite.js), data from `src/lib/satellites/catalog.ts`.

### AG-UI / CopilotKit layer (`src/lib/a2a/`, `src/app/api/copilotkit/`)

`/orchestration` and `/dashboard` share the CopilotKit runtime at `src/app/api/copilotkit/route.ts`, with `ExperimentalEmptyAdapter` (agents emit their own events, so **no LLM key is needed at the runtime level**). Two agents are registered:

- `satelliteAnalyst` — an `@ag-ui/client` `HttpAgent` pointing at the **CrewAI Python backend** (`backend/`, AG-UI `POST /agent`). This is the official CopilotKit↔CrewAI pattern; see `docs/agent-backend-crewai.md`. To run it: `cd backend && uv run uvicorn app:app --port 8000`.
- `satellite_dashboard` — an in-process AG-UI `AbstractAgent` (`src/lib/a2a/dashboard-agent.ts`) reusing `getDashboardData` + `generateChatAnswer` (deterministic fallback preserved).

Bind a page via `<CopilotKit agent="satelliteAnalyst|satellite_dashboard">`. The Python backend is the swap point for real agents/MCP/A2A (the old in-process `OrchestrationMockAgent` was removed). Shared navigation is `src/components/site-nav.tsx`.

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
