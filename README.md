# SatIntel Command Center

A modular satellite/remote-sensing intelligence app pairing an `LLM + News Feed` with an
A2A multi-agent layer surfaced through AG-UI / CopilotKit, plus a 3D satellite globe.

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Chinese satellite news feed + Ask AI (unchanged contract) |
| `/orchestration` | AG-UI conversational view of the A2A multi-agent run (CopilotKit) |
| `/dashboard` | CopilotKit conversational dashboard over the live feed |
| `/globe` | 3D Earth map of each country's flagship satellites |

## What it does

- Aggregates signals from multiple source adapters.
- Normalizes and scores incoming articles by freshness, relevance, and urgency.
- Generates operator briefings and collaborative chat answers through an OpenAI SDK compatible model interface.
- Visualizes A2A agent-to-agent state calls as a chat stream (AG-UI), with state-driven panels.
- Renders flagship satellites on a 3D globe with real SGP4 orbit propagation.
- Keeps the ingestion layer modular so `RSS`, `WeChat URL`, internal APIs, and future crawlers can be added without rewriting the UI.

## Stack

- `Next.js 16` · `React 19` · `TypeScript` · `Tailwind CSS v4`
- `OpenAI SDK compatible provider`
- `@copilotkit/*` + `@ag-ui/*` (AG-UI protocol, agent ↔ user)
- `react-globe.gl` + `three` + `satellite.js` (3D globe + orbit propagation)

## Environment

Create `.env.local` if you want live LLM generation:

```bash
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://your-compatible-endpoint/v1
OPENAI_MODEL=your-model-name
SATINTEL_WECHAT_URLS=https://mp.weixin.qq.com/s/...
```

Optional:

```bash
SATINTEL_RSS_SOURCES=https://spacenews.com/feed/,https://www.nasa.gov/rss/dyn/breaking_news.rss
SATINTEL_CRAWL_URLS=https://example.com/public-article
```

Without environment variables, the app still runs with seeded intelligence records and heuristic summaries.

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Architecture

- `src/lib/intel/adapters/*`: source-specific collectors.
- `src/lib/backend/mock-backend.ts`: simulated backend facade for source runs, RSS subscriptions, crawl targets, and LLM state.
- `src/lib/intel/service.ts`: orchestration, dedupe, ranking, trend extraction.
- `src/lib/intel/llm.ts`: OpenAI-compatible summary and chat provider abstraction.
- `src/app/api/*`: feed, briefing, collaborative chat, and the `/api/copilotkit` AG-UI runtime.
- `src/lib/a2a/*`: in-process AG-UI agents (A2A orchestration replay + dashboard agent).
- `src/lib/satellites/catalog.ts`: flagship-satellite catalog with generated, valid TLEs.
- `src/components/{orchestration,dashboard-copilot,globe}/*`: the three new page shells.
- `docs/system-blueprint.md`: design goals, phase plan, and quantized acceptance metrics.
- `docs/mock-backend.md`: frontend contract analysis plus RSS and crawl backend logic.
- `docs/copilotkit-dashboard.md` · `docs/a2a-orchestration-ui.md` · `docs/satellite-globe.md`: the new surfaces.
- `docs/dev-log.md`: development log (decisions, tech stack, phase progress).

## Notes

- The included `WeChatUrlAdapter` is a production-safe placeholder that can ingest public article URLs provided by configuration. It does not attempt to bypass access controls.
- The system is intentionally built so a dedicated crawler, queue, or vector index can be plugged in later with minimal surface changes.
