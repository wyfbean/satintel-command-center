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

`src/lib/intel/service.ts` is the orchestration entry point. It runs static catalog + user RSS feeds in parallel, then dedupes/ranks/enriches:

```
sourceCatalog (catalog.ts) + listFeeds() (rss-store.ts / SQLite)
  → adapterRegistry { mock | rss | crawl | wechat-url }   (mock-backend.ts)
  → RawIntelRecord[]                                       (types/intel.ts)
  → dedupeAndRank + extractTrendSignals                    (scoring.ts)
  → enrichItemSummary (top 8 only) + generateBriefing      (llm.ts  ← cached)
  → DashboardData
```

Key invariants:

- All adapters normalize to `RawIntelRecord`. The UI never knows the source kind.
- Scoring: `freshness×0.3 + relevance×0.42 + urgency×0.28`. Dedupe key: `title.toLowerCase()::url`.
- LLM enrichment on top 8 only to cap token spend. `enrichItemSummary` is cached 7 days; `generateBriefing` 6 hours — both in SQLite.
- All LLM output must be Chinese. System prompts in `llm.ts` enforce this with explicit instructions. The `SUMMARY:`/`WHY:` and `SECTION: heading :: body` markers are load-bearing for the response parsers — do not reword.
- `CrawlAdapter`: fetch only explicitly configured public URLs; no login, anti-bot bypass, or private content.

### Persistence layer (`data/intel-cache.db`, SQLite via `better-sqlite3`)

All SQLite I/O is **synchronous** (better-sqlite3 API). The DB is lazy-opened; any error sets `_failed = true` and all functions silently no-op. The `data/` directory is git-ignored.

| Table | Module | Purpose |
|---|---|---|
| `llm_cache` | `src/lib/intel/cache.ts` | LLM response cache; per-entry SHA-256 key + TTL |
| `user_rss_feeds` | `src/lib/intel/rss-store.ts` | User-managed subscriptions added via `/api/rss` |

Note: `cache.ts` and `rss-store.ts` each maintain their **own** `_db` singleton pointing at the same file — they do not share a connection object.

### HTTP contracts (`src/app/api/`)

Stable contracts — do not change shape without updating both shells and the mock backend:

- `GET /api/feed` → `DashboardData`
- `GET /api/briefing` → `{ briefing: BriefingSection[] }`
- `POST /api/chat` → `{ answer: string }`, body `{ messages, selectedIds?, missionContext? }`. Empty `selectedIds` → top 3 ranked items used as grounding.
- `GET /api/rss` / `POST /api/rss` / `DELETE|PATCH /api/rss/:id` — user RSS CRUD (persisted to SQLite)
- `POST /api/rss/test` → `{ count, title }` — validates a URL before saving
- `GET /api/backend/overview` / `POST /api/backend/crawl` — inspection-only

### Dashboard shell (`src/components/dashboard/dashboard-shell.tsx`)

- `NEXT_PUBLIC_FEED_MODE=mock` bypasses `/api/feed` and renders `frontendMockDashboardData`.
- Scroll drives `selectedId` via `feedNodeMap` ref + viewport-anchor measurement. Changing feed card layout must preserve `registerNode(id, el)` calls or scroll-sync breaks.
- The unified top widget (日期 + AI速览 + Agent) is rendered before the 3-column feed grid. `今日AI速览` is **not** in the right sidebar — it was moved to the top widget.

### `/orchestration` shell

`useCopilotAction({ name: "*", render })` catches all tool calls. The render callback returns JSX — use `Boolean(unknownValue)` (not `unknownValue &&`) when gating JSX on `unknown`-typed render props (TS error 2322 otherwise). `dynamic = "force-dynamic"` is required on the page.

### Globe (`/globe`)

`next/dynamic` with `ssr: false`. Pin `satellite.js` to **v5** (pure-JS SGP4) — v7 imports `node:worker_threads` and hangs turbopack production builds. `transpilePackages: ["react-globe.gl", "three-globe"]` in `next.config.ts` is required.

## Conventions

- Path alias: `@/*` → `src/*` (see `tsconfig.json`).
- User-facing copy in the dashboard, briefing prompts, and Chinese fallback strings is `zh-CN`. LLM system prompts in `llm.ts` enforce Chinese output and a strict line/section format (`SUMMARY:` / `WHY:` / `SECTION: heading :: body`) — the parser depends on these markers, so don't reword them casually.
- New source types: add a `SourceKind` in `types/intel.ts`, implement `SourceAdapter`, register in `adapterRegistry`, and add entries to `sourceCatalog`. Nothing else in the pipeline should need to change.
