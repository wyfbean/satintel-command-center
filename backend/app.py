"""FastAPI server exposing both AG-UI agent pipelines from a single process.

Two pipelines share this one backend (and one `backend/` venv) — they only differ
by path, not by port:

* `POST /agent` + `GET /health` — the satellite multi-agent **CrewAI** crew
  (`satintel_agents/agui.py`), registered in the frontend as `satelliteAnalyst`.
* `POST /orchestrator/agent` + `GET /orchestrator/health` — the **Magnetic-One**-style
  model-wrapper orchestrator (`orchestrator/agui_bridge.py`), registered as
  `magneticOrchestrator`. (`orchestrator/app.py` can still be run standalone on its own
  port when prod wants the two pipelines on separate hosts — set `ORCHESTRATOR_BACKEND_URL`.)

Both accept an AG-UI `RunAgentInput` and stream AG-UI SSE events consumed by the Next.js
CopilotKit `HttpAgent`s. Each runs its real LLM pipeline when `OPENAI_API_KEY` is set,
otherwise a deterministic mock that still exercises the bundled tools.
"""

from __future__ import annotations

import os
from pathlib import Path

# Load backend/.env into os.environ BEFORE importing the agent modules — neither
# `uv run` nor uvicorn auto-loads it, so without this OPENAI_API_KEY stays unset
# and both pipelines silently fall back to deterministic mock mode.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent / ".env")

from ag_ui.core import RunAgentInput  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402

from orchestrator.agui_bridge import run_agent_stream as run_orchestrator_stream  # noqa: E402
from satintel_agents.agui import run_agent_stream  # noqa: E402

app = FastAPI(title="SatIntel Agents", version="0.1.0")

# CORS: comma-separated origins via env var; fallback to localhost for dev.
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _mode() -> str:
    return "live" if os.environ.get("OPENAI_API_KEY") else "mock"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": _mode()}


@app.post("/agent")
async def agent(input_data: RunAgentInput) -> StreamingResponse:
    return StreamingResponse(run_agent_stream(input_data), media_type="text/event-stream")


@app.get("/orchestrator/health")
def orchestrator_health() -> dict[str, str]:
    return {"status": "ok", "mode": _mode()}


@app.post("/orchestrator/agent")
async def orchestrator_agent(input_data: RunAgentInput) -> StreamingResponse:
    return StreamingResponse(run_orchestrator_stream(input_data), media_type="text/event-stream")
