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
import json
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
                if cleaned and not cleaned.startswith(("{", "[")):
                    return cleaned
    return None


def _parse_context_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    for _ in range(2):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return text
        if isinstance(parsed, str):
            text = parsed.strip()
            continue
        return parsed
    return text


def _attached_images(input_data: RunAgentInput) -> list[dict[str, Any]]:
    for ctx in input_data.context or []:
        desc = (getattr(ctx, "description", "") or "").lower()
        if "attached_satellite_images" not in desc:
            continue
        parsed = _parse_context_value(getattr(ctx, "value", None))
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
        if isinstance(parsed, dict):
            images = parsed.get("images")
            if isinstance(images, list):
                return [item for item in images if isinstance(item, dict)]
    return []


def _attached_image_metadata(input_data: RunAgentInput) -> dict[str, Any] | None:
    for ctx in input_data.context or []:
        desc = (getattr(ctx, "description", "") or "").lower()
        if "attached_image_metadata" not in desc:
            continue
        parsed = _parse_context_value(getattr(ctx, "value", None))
        return parsed if isinstance(parsed, dict) else None
    return None


def _images_from_metadata(metadata: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not metadata:
        return []
    images = metadata.get("images")
    if not isinstance(images, list):
        return []
    out: list[dict[str, Any]] = []
    for item in images:
        if isinstance(item, dict):
            out.append({"name": item.get("filename"), "rawRef": item.get("rawRef"), "metadata": item})
    return out


def _primary_image_ref(images: list[dict[str, Any]], fallback: str | None) -> str | None:
    for image in images:
        for key in ("rawRef", "image", "dataUrl"):
            val = image.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
    return fallback


async def run_agent_stream(input_data: RunAgentInput) -> AsyncIterator[str]:
    thread_id = input_data.thread_id or new_id()
    run_id = input_data.run_id or new_id()
    query = _latest_user_text(input_data)
    images = _attached_images(input_data)
    image_metadata = _attached_image_metadata(input_data)
    if not images:
        images = _images_from_metadata(image_metadata)
    image_ref = _primary_image_ref(images, _attached_image(input_data))

    yield run_started(thread_id, run_id)
    try:
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def emit(kind: str, payload: dict[str, Any]) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, (kind, payload))

        task = asyncio.create_task(asyncio.to_thread(run_magnetic, query, image_ref, emit, images, image_metadata))

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
