# Mock Backend System

## Frontend contract analysis

The dashboard frontend is already backend-ready. It depends on three HTTP contracts:

- `GET /api/feed`: returns `DashboardData` for the timeline, filters, trends, source summary, and initial briefing.
- `GET /api/briefing`: returns `{ briefing }` to regenerate the right-side operator briefing.
- `POST /api/chat`: returns `{ answer }` for Ask AI, grounded by selected news item IDs.

The UI does not need raw crawler internals. It needs normalized `IntelItem` records with:

- source identity: `sourceId`, `sourceName`, `sourceLabel`, `channel`
- article identity: `id`, `title`, `url`, `publishedAt`
- extracted text: `excerpt`, `body`
- intelligence fields: `summary`, `whyItMatters`, `tags`, `extractedEntities`, scores, trend keys

## Backend simulation boundary

The simulated backend is implemented in `src/lib/backend/mock-backend.ts`.

It models a real backend pipeline without adding database or queue infrastructure:

1. Load configured sources from `src/lib/intel/catalog.ts`.
2. Route each source to a source adapter.
3. Collect raw records in parallel.
4. Normalize each record to the shared `RawIntelRecord` shape.
5. Score, dedupe, rank, and enrich records through the existing intelligence service.
6. Call the OpenAI-compatible LLM abstraction when configured, otherwise use deterministic fallback text.

The extra backend inspection endpoints are:

- `GET /api/backend/overview`: returns configured LLM state, RSS subscriptions, crawl targets, source list, and frontend contracts.
- `POST /api/backend/crawl`: runs one mock ingestion pass for `rss`, `crawl`, and `wechat-url` sources and returns source reports plus raw records.

## RSS implementation logic

RSS subscriptions are configured with:

```bash
SATINTEL_RSS_SOURCES=https://spacenews.com/feed/,https://www.nasa.gov/rss/dyn/breaking_news.rss
```

The RSS adapter follows common feed conventions:

- RSS 2.0 path: `rss.channel.item`
- Atom path: `feed.entry`
- title: `title`
- URL: string `link` or object `link.href`
- summary/body: `description`, `summary`, or `content:encoded`
- published time: `pubDate`, `published`, `updated`, or current time fallback

The adapter strips HTML, limits each source to a small recent batch, assigns source tags/region, and guesses imagery modes from keywords such as `SAR`, `optical`, `multispectral`, `遥感`, and `影像`.

## Crawl implementation logic

Generic crawl targets are configured with:

```bash
SATINTEL_CRAWL_URLS=https://example.com/article-a,https://example.com/article-b
```

`SATINTEL_WECHAT_URLS` is still supported for the older WeChat public URL placeholder.

The generic crawler intentionally stays conservative:

- only fetch explicitly configured public URLs
- no login, anti-bot bypass, or private-content scraping
- extract `<title>`, `og:title`, `description`, `og:description`, `<article>` paragraphs, and `<p>` paragraphs
- timestamp crawled records with the fetch time
- normalize output to the same `RawIntelRecord` shape as RSS

This keeps the front end independent from whether an item came from RSS, a public HTML page, a WeChat URL placeholder, or seeded mock data.

## LLM provider

The LLM layer uses the OpenAI SDK with OpenAI-compatible settings:

```bash
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://your-compatible-endpoint/v1
OPENAI_MODEL=your-model-name
```

No live LLM test is required for this mock backend. If no key is configured, the system returns heuristic summaries and deterministic chat answers so the frontend remains usable.
