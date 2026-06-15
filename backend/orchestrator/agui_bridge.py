"""AG-UI streaming bridge for the Magnetic-One-style orchestrator.

Exposes `run_agent_stream(input_data)` — an async generator of AG-UI SSE
strings consumed by the Next.js CopilotKit `HttpAgent`. Mirrors
`satintel_agents/agui.py`'s structure: extracts the latest user message and
any attached image from AG-UI `RunAgentInput`, runs `magnetic.run_magnetic`
in a worker thread, and bridges its `emit(kind, payload)` callbacks to AG-UI
text/tool-call events.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

from ag_ui.core import RunAgentInput

from .agui_helpers import assistant_text, new_id, run_finished, run_started, tool_call
from .magnetic import run_magnetic


def _latest_user_text(input_data: RunAgentInput) -> str:
    for msg in reversed(input_data.messages or []):
        if getattr(msg, "role", None) == "user":
            content = getattr(msg, "content", None)
            if isinstance(content, str) and content.strip():
                return content.strip()
    return "分析当前卫星场景"


def _attached_image(input_data: RunAgentInput) -> str | None:
    for ctx in input_data.context or []:
        desc = (getattr(ctx, "description", "") or "").lower()
        if "image" in desc or "图像" in desc:
            val = getattr(ctx, "value", None)
            if isinstance(val, str):
                cleaned = val.strip().strip('"')
                if cleaned.startswith("data:") or cleaned.startswith("http"):
                    return cleaned
    return None


async def run_agent_stream(input_data: RunAgentInput) -> AsyncIterator[str]:
    thread_id = input_data.thread_id or new_id()
    run_id = input_data.run_id or new_id()
    query = _latest_user_text(input_data)
    image_ref = _attached_image(input_data)

    yield run_started(thread_id, run_id)
    try:
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def emit(kind: str, payload: dict[str, Any]) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, (kind, payload))

        task = asyncio.create_task(asyncio.to_thread(run_magnetic, query, image_ref, emit))

        while True:
            try:
                kind, payload = await asyncio.wait_for(queue.get(), timeout=300)
            except asyncio.TimeoutError:
                break
            if kind == "__done__":
                break
            if kind == "text":
                async for e in assistant_text(payload.get("text", ""), delay=0.0):
                    yield e
            elif kind == "tool":
                async for e in tool_call(payload["name"], payload.get("args", {}), payload.get("result", {})):
                    yield e

        await task
    finally:
        yield run_finished(thread_id, run_id)
