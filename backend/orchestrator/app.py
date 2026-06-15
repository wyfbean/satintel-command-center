"""FastAPI server exposing the Magnetic-One-style model-wrapper orchestrator over AG-UI.

`POST /agent` accepts an AG-UI `RunAgentInput` and streams AG-UI SSE events that the
Next.js CopilotKit `HttpAgent` (registered in src/app/api/copilotkit/route.ts as
`magneticOrchestrator`) consumes. Mirrors `backend/app.py`; runs on a separate port
(default 8100) so it can coexist with the existing satellite-crew backend (8000).
"""

from __future__ import annotations

import os

from ag_ui.core import RunAgentInput
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from orchestrator.agui_bridge import run_agent_stream

app = FastAPI(title="SatIntel Model-Wrapper Orchestrator", version="0.1.0")

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": "live" if os.environ.get("OPENAI_API_KEY") else "mock"}


@app.post("/agent")
async def agent(input_data: RunAgentInput) -> StreamingResponse:
    return StreamingResponse(run_agent_stream(input_data), media_type="text/event-stream")
