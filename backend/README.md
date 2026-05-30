# SatIntel Agents (CrewAI + AG-UI backend)

Python multi-agent backend for the `/orchestration` chat. Exposes a CrewAI crew over the
**AG-UI protocol** so the Next.js CopilotKit frontend renders the multi-agent collaboration
and **MCP tool-call results** inline in a ChatGPT-style chat.

## Run

```bash
cd backend
uv sync                 # install deps (CrewAI, crewai-tools[mcp], FastAPI, ag-ui, mcp)
uv run uvicorn app:app --host 127.0.0.1 --port 8000
```

`GET /health` → `{ "status": "ok", "mode": "live" | "mock" }`
`POST /agent` → AG-UI SSE stream (consumed by the frontend `HttpAgent`).

The Next.js app proxies `/api/agent/*` → this server (see `next.config.ts`) and registers it as
the `satelliteAnalyst` agent in `src/app/api/copilotkit/route.ts`.

## Modes

- **mock** (default, zero env vars): a deterministic multi-agent collaboration that calls the
  real satellite tool implementations (`satintel_agents/satellite_tools_impl.py`) and streams
  genuine tool-call results. Lets the page demo offline.
- **live**: set `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`, vision-capable `OPENAI_MODEL`)
  in `backend/.env`. Runs the real CrewAI crew (`satintel_agents/crew.py`): a multimodal image
  analyst + reporter using the bundled MCP tools via `MCPServerAdapter`. Any failure degrades to
  mock mode.

## Bundled satellite MCP server

`mcp_server/server.py` is a self-contained stdio MCP server exposing satellite-themed tools
(`segment_image`, `detect_objects`, `tle_lookup`, `geo_locate`). The crew connects to it with
`crewai_tools.MCPServerAdapter`. Point at real MCP/A2A servers later by editing
`satintel_agents/crew.py`.

## Layout

```
backend/
├─ app.py                              FastAPI: /agent (AG-UI SSE), /health
├─ satintel_agents/
│  ├─ agui.py                          AG-UI streaming bridge (mock + real, key-gated)
│  ├─ crew.py                          real CrewAI crew + event→AG-UI forwarding
│  └─ satellite_tools_impl.py          deterministic tool logic (shared)
└─ mcp_server/server.py                bundled satellite MCP server (stdio)
```
