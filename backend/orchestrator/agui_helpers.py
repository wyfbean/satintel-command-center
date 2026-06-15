"""AG-UI SSE event helpers (encoder wrappers), shared by `agui_bridge.py`.

A small, deliberate copy of the helper shapes in
`satintel_agents/agui.py` (text-message + tool-call lifecycle encoders) —
kept local to `orchestrator/` so the existing, working `/orchestration`
CrewAI bridge is not touched while this package is developed.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, AsyncIterator

from ag_ui.core import (
    EventType,
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

_encoder = EventEncoder()


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def run_started(thread_id: str, run_id: str) -> str:
    return _encoder.encode(RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id))


def run_finished(thread_id: str, run_id: str) -> str:
    return _encoder.encode(RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id))


async def assistant_text(text: str, *, chunk: int = 28, delay: float = 0.02) -> AsyncIterator[str]:
    """Stream one assistant message as START -> CONTENT* -> END."""
    mid = new_id()
    yield _encoder.encode(TextMessageStartEvent(type=EventType.TEXT_MESSAGE_START, message_id=mid, role="assistant"))
    for i in range(0, len(text), chunk):
        yield _encoder.encode(
            TextMessageContentEvent(type=EventType.TEXT_MESSAGE_CONTENT, message_id=mid, delta=text[i : i + chunk])
        )
        await asyncio.sleep(delay)
    yield _encoder.encode(TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=mid))


async def tool_call(name: str, args: dict[str, Any], result: dict[str, Any]) -> AsyncIterator[str]:
    """Emit a full tool-call lifecycle with its result (renders as a tool card in chat)."""
    tcid = new_id()
    yield _encoder.encode(ToolCallStartEvent(type=EventType.TOOL_CALL_START, tool_call_id=tcid, tool_call_name=name))
    yield _encoder.encode(
        ToolCallArgsEvent(type=EventType.TOOL_CALL_ARGS, tool_call_id=tcid, delta=json.dumps(args, ensure_ascii=False))
    )
    yield _encoder.encode(ToolCallEndEvent(type=EventType.TOOL_CALL_END, tool_call_id=tcid))
    yield _encoder.encode(
        ToolCallResultEvent(
            type=EventType.TOOL_CALL_RESULT,
            message_id=new_id(),
            tool_call_id=tcid,
            content=json.dumps(result, ensure_ascii=False),
            role="tool",
        )
    )
    await asyncio.sleep(0.02)
