# SatIntel Command Center

A modular `LLM + News Feed` system for satellite, remote sensing, and space-industry intelligence.

## What it does

- Aggregates signals from multiple source adapters.
- Normalizes and scores incoming articles by freshness, relevance, and urgency.
- Generates operator briefings and collaborative chat answers through an OpenAI SDK compatible model interface.
- Exposes a dashboard-first UI for triage, summarization, and mission discussion.
- Keeps the ingestion layer modular so `RSS`, `WeChat URL`, internal APIs, and future crawlers can be added without rewriting the UI.

## Stack

- `Next.js 16`
- `React 19`
- `TypeScript`
- `Tailwind CSS v4`
- `OpenAI SDK compatible provider`

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
- `src/app/api/*`: feed, briefing, and collaborative chat endpoints.
- `src/components/dashboard/*`: dashboard UI and collaboration panel.
- `docs/system-blueprint.md`: design goals, phase plan, and quantized acceptance metrics.
- `docs/mock-backend.md`: frontend contract analysis plus RSS and crawl backend logic.

## Notes

- The included `WeChatUrlAdapter` is a production-safe placeholder that can ingest public article URLs provided by configuration. It does not attempt to bypass access controls.
- The system is intentionally built so a dedicated crawler, queue, or vector index can be plugged in later with minimal surface changes.
