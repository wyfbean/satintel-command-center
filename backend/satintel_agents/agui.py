"""AG-UI streaming bridge for the satellite multi-agent backend.

Exposes `run_agent_stream(input_data)` — an async generator of AG-UI SSE strings that
the Next.js CopilotKit `HttpAgent` consumes. Two modes:

* **real** (when `OPENAI_API_KEY` is set and CrewAI imports cleanly): runs the CrewAI
  crew (`crew.py`) and bridges its event bus → AG-UI events. Authored against the
  official CopilotKit↔CrewAI / CrewAI event-listener guides.
* **mock** (default offline): a deterministic multi-agent collaboration that calls the
  real satellite tool implementations, so the chat shows genuine tool-call results with
  zero env vars. Any failure in real mode falls back to this.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from typing import Any, AsyncIterator

from ag_ui.core import (
    EventType,
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder

from .satellite_tools_impl import TOOLS

_encoder = EventEncoder()


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


# --- event helpers (each returns an encoded SSE string) ------------------------------

def _run_started(thread_id: str, run_id: str) -> str:
    return _encoder.encode(RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id))


def _run_finished(thread_id: str, run_id: str) -> str:
    return _encoder.encode(RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id))


async def _assistant_text(text: str, *, chunk: int = 28, delay: float = 0.03) -> AsyncIterator[str]:
    """Stream one assistant message as START → CONTENT* → END."""
    mid = _new_id()
    yield _encoder.encode(TextMessageStartEvent(type=EventType.TEXT_MESSAGE_START, message_id=mid, role="assistant"))
    for i in range(0, len(text), chunk):
        yield _encoder.encode(
            TextMessageContentEvent(type=EventType.TEXT_MESSAGE_CONTENT, message_id=mid, delta=text[i : i + chunk])
        )
        await asyncio.sleep(delay)
    yield _encoder.encode(TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=mid))


async def _tool_call(name: str, args: dict[str, Any], result: dict[str, Any]) -> AsyncIterator[str]:
    """Emit a full tool-call lifecycle with its result (renders as a tool card in chat)."""
    tcid = _new_id()
    yield _encoder.encode(ToolCallStartEvent(type=EventType.TOOL_CALL_START, tool_call_id=tcid, tool_call_name=name))
    yield _encoder.encode(
        ToolCallArgsEvent(type=EventType.TOOL_CALL_ARGS, tool_call_id=tcid, delta=json.dumps(args, ensure_ascii=False))
    )
    yield _encoder.encode(ToolCallEndEvent(type=EventType.TOOL_CALL_END, tool_call_id=tcid))
    yield _encoder.encode(
        ToolCallResultEvent(
            type=EventType.TOOL_CALL_RESULT,
            message_id=_new_id(),
            tool_call_id=tcid,
            content=json.dumps(result, ensure_ascii=False),
            role="tool",
        )
    )
    await asyncio.sleep(0.04)


# --- input extraction ----------------------------------------------------------------

def _latest_user_text(input_data: RunAgentInput) -> str:
    for msg in reversed(input_data.messages or []):
        if getattr(msg, "role", None) == "user":
            content = getattr(msg, "content", None)
            if isinstance(content, str) and content.strip():
                return content.strip()
    return "分析当前卫星场景"


def _attached_image(input_data: RunAgentInput) -> str | None:
    """The frontend exposes any attached satellite image via AG-UI context."""
    for ctx in input_data.context or []:
        desc = (getattr(ctx, "description", "") or "").lower()
        if "image" in desc or "图像" in desc:
            val = getattr(ctx, "value", None)
            if isinstance(val, str) and val:
                return val
    return None


# --- mock mode (deterministic, calls the real tool impls) ----------------------------

async def _mock_run(query: str, image_ref: str | None) -> AsyncIterator[str]:
    has_image = bool(image_ref)
    ref = image_ref or "scene"

    async for e in _assistant_text(
        f"【协调员 Coordinator】已收到任务：「{query}」。"
        + ("检测到附带卫星图像，将交由影像分析与分割工具处理。" if has_image else "未附带图像，将基于地理/轨道工具检索。")
    ):
        yield e

    if has_image:
        async for e in _assistant_text("【影像分析 Image Analyst】正在调用目标检测与分割 MCP 工具……", delay=0.02):
            yield e
        async for e in _tool_call("detect_objects", {"image_ref": ref}, TOOLS["detect_objects"](ref)):
            yield e
        async for e in _tool_call("segment_image", {"image_ref": ref}, TOOLS["segment_image"](ref)):
            yield e
    else:
        async for e in _tool_call("geo_locate", {"query": query}, TOOLS["geo_locate"](query)):
            yield e
        async for e in _tool_call("tle_lookup", {"satellite": query}, TOOLS["tle_lookup"](query)):
            yield e

    async for e in _assistant_text(
        "【报告员 Reporter】已综合各智能体与 MCP 工具的结果："
        + ("分割与检测结果已在上方卡片中给出，可据此进一步研判。" if has_image
           else "地理定位与轨道信息已返回，可继续追问目标区域或卫星。")
    ):
        yield e


# --- real mode (CrewAI; best-effort, lazy import) ------------------------------------

async def _crew_run(query: str, image_ref: str | None) -> AsyncIterator[str]:
    """Run the real CrewAI crew and bridge its events to AG-UI.

    Lazy-imports CrewAI so the backend still serves mock mode if CrewAI isn't installed.
    Streams agent/tool events from the CrewAI event bus, then the final result.
    """
    from .crew import run_crew_streaming  # noqa: PLC0415

    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def emit(kind: str, payload: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, (kind, payload))

    task = asyncio.create_task(asyncio.to_thread(run_crew_streaming, query, image_ref, emit))

    while True:
        try:
            kind, payload = await asyncio.wait_for(queue.get(), timeout=120)
        except asyncio.TimeoutError:
            break
        if kind == "__done__":
            break
        if kind == "text":
            async for e in _assistant_text(payload.get("text", ""), delay=0.0):
                yield e
        elif kind == "tool":
            async for e in _tool_call(payload["name"], payload.get("args", {}), payload.get("result", {})):
                yield e

    await task


# --- public entrypoint ---------------------------------------------------------------

def _llm_configured() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


async def run_agent_stream(input_data: RunAgentInput) -> AsyncIterator[str]:
    thread_id = input_data.thread_id or _new_id()
    run_id = input_data.run_id or _new_id()
    query = _latest_user_text(input_data)
    image_ref = _attached_image(input_data)

    yield _run_started(thread_id, run_id)
    try:
        if _llm_configured():
            try:
                async for e in _crew_run(query, image_ref):
                    yield e
            except Exception as exc:  # noqa: BLE001 - degrade to mock on any real-mode failure
                async for e in _assistant_text(f"（实时 CrewAI 运行不可用，回退到确定性演示：{exc}）"):
                    yield e
                async for e in _mock_run(query, image_ref):
                    yield e
        else:
            async for e in _mock_run(query, image_ref):
                yield e
    finally:
        yield _run_finished(thread_id, run_id)
