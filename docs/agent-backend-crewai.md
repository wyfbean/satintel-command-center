# CrewAI agent backend + `/orchestration` chat

`/orchestration` is a ChatGPT/OpenWebUI-style **single-window chat** (no side widgets) for a
**CrewAI multi-agent** backend. The collaboration and **MCP/A2A tool-call results** render
**inline in the conversation**. Built by reusing CopilotKit + AG-UI per the official
CopilotKit↔CrewAI guide.

## Topology

```
/orchestration (CopilotChat, agent="satelliteAnalyst")
   │  CopilotKit transport
Next.js /api/copilotkit  ── HttpAgent({ url: AGENT_BACKEND_URL ?? http://127.0.0.1:8000/agent })
   │  AG-UI over HTTP (RunAgentInput → AG-UI SSE events)
FastAPI backend/  POST /agent
   ├─ agui.run_agent_stream: emits AG-UI events (RUN/TEXT/TOOL_CALL+RESULT)
   ├─ live: CrewAI crew (multimodal image analyst + reporter) + MCPServerAdapter
   └─ mock: deterministic collaboration calling the real satellite tools
```

`/api/agent/health` proxies the backend `GET /health` so the page shows an offline hint when
the Python service isn't running.

## Run both processes (dev)

```bash
# terminal 1 — agent backend
cd backend && uv sync && uv run uvicorn app:app --host 127.0.0.1 --port 8000 --reload

# terminal 2 — Next.js
npm run dev          # http://localhost:3000
```

The frontend works without the backend too, but `/orchestration` will show an "agent backend
offline" banner and cannot reply until uvicorn is up.

## Modes

- **mock** (default, zero env vars): `backend/satintel_agents/agui.py` streams a deterministic
  multi-agent run that calls the real tool implementations
  (`satintel_agents/satellite_tools_impl.py`). Text queries → `geo_locate` + `tle_lookup`;
  an attached image → `detect_objects` + `segment_image` (rendered as a segmentation overlay).
- **live**: set `OPENAI_API_KEY` (+ vision-capable `OPENAI_MODEL`) in `backend/.env`. Runs the
  real CrewAI crew (`crew.py`) using the bundled MCP tools via `crewai_tools.MCPServerAdapter`.
  Any failure degrades to mock mode.

## Multimodal image flow

The composer "附加卫星图像" button downscales the image to a data URL and exposes it via
`useCopilotReadable({ description: "attached_satellite_image", value })`. The backend reads it
from `RunAgentInput.context` (only accepting a real `data:`/`http` value) and routes to the
image tools. The frontend `ToolResultCard` overlays segmentation regions (normalized 0–100
bbox) on the attached image.

## Tool-call result rendering

`useCopilotAction({ name: "*", render })` renders every tool call the agent makes as an inline
card (name + args + result). `segment_image` → SVG region overlay; `detect_objects` → object
list; other tools → pretty-printed JSON. This is the generic **MCP/A2A tool-call result**
surface — segmentation is just one example tool.

## Swapping in real MCP/A2A servers

`backend/mcp_server/server.py` is a self-contained stdio MCP server (segment_image,
detect_objects, tle_lookup, geo_locate). To use real MCP/A2A servers, edit
`backend/satintel_agents/crew.py`'s `MCPServerAdapter` configuration (stdio command or SSE URL);
the frontend rendering is unchanged.
