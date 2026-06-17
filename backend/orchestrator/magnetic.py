"""Single tool-calling agent (autogen-style) for the /orchestration chat.

Replaces the former 5-stage CrewAI pipeline with **one** LLM agent: given the
user's request (and any attached image) it decides which `model_wrappers` tools
to call, calls them in a loop (OpenAI function-calling), and writes a concise
Chinese conclusion. Planning is implicit in the single agent's reasoning;
"execution" is just the agent invoking tools.

`run_magnetic(query, image_ref, emit)` keeps its name/signature so
`agui_bridge.py` is untouched. `emit(kind, payload)` carries `text` / `tool`
events and finally `__done__`.

Two modes:
  - **real** (`OPENAI_API_KEY` set): OpenAI function-calling loop; tools are the
    5 model wrappers (`schemas.TOOL_SCHEMAS`), executed via `model_wrappers.*`.
    The attached image is injected into image-taking tools at execution time, so
    the base64 never enters the LLM context.
  - **mock** (default, no key): deterministic single-agent flow that ALWAYS emits
    at least one visible tool call plus a final conclusion — including for
    text-only input — so the loop shape is demonstrated rather than silently
    skipped.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable

Emit = Callable[[str, dict[str, Any]], None]

MAX_TOOL_ROUNDS = 4

# Tools whose `image` argument is auto-filled from the attached image at
# execution time (every model wrapper takes an image; sattxt's is optional).
_IMAGE_TOOLS = {"skyeyegpt", "sarmae", "dofa", "sattxt", "mtp"}

# RGB-only DOFA head — an arbitrary uploaded RGB photo cannot satisfy a
# multispectral head (e.g. m-chesapeake), which raises on missing bands.
_DEFAULT_DOFA_HEAD = "m-pv4ger-seg"


def _llm_configured() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def run_magnetic(query: str, image_ref: str | None, emit: Emit) -> None:
    emit("text", {"text": "正在分析……"})
    if _llm_configured():
        try:
            _run_agent(query, image_ref, emit)
            emit("__done__", {})
            return
        except Exception as exc:  # noqa: BLE001 - degrade to mock on any real-mode failure
            emit("text", {"text": f"（实时智能体不可用，回退到确定性演示：{exc}）"})
    _run_mock(query, image_ref, emit)
    emit("__done__", {})


# --------------------------------------------------------------------------- #
# tool plumbing (shared by real + mock)
# --------------------------------------------------------------------------- #

def _safe_call(name: str, args: dict[str, Any], image_ref: str | None) -> dict[str, Any]:
    """Execute one model wrapper, injecting the attached image, never raising."""
    from model_wrappers import remote_models as rm  # noqa: PLC0415

    func = getattr(rm, name, None)
    if func is None:
        return {"ok": False, "model": name, "task": "", "error": f"unknown tool '{name}'"}
    call_args = dict(args or {})
    if image_ref and name in _IMAGE_TOOLS:
        call_args["image"] = image_ref
    try:
        return func(**call_args)
    except Exception as exc:  # noqa: BLE001 - surface as an ok=False envelope
        return {"ok": False, "model": name, "task": call_args.get("task", ""), "error": str(exc)}


def _openai_tools() -> list[dict[str, Any]]:
    """Map TOOL_SCHEMAS → OpenAI function-calling tool defs, hiding `image`
    (auto-injected at execution time, so the model never invents a path)."""
    from model_wrappers.schemas import TOOL_SCHEMAS  # noqa: PLC0415

    tools: list[dict[str, Any]] = []
    for name, spec in TOOL_SCHEMAS.items():
        params = json.loads(json.dumps(spec["input"]))  # deep copy
        params.get("properties", {}).pop("image", None)
        if isinstance(params.get("required"), list):
            params["required"] = [r for r in params["required"] if r != "image"]
        tools.append(
            {
                "type": "function",
                "function": {"name": name, "description": spec["description"], "parameters": params},
            }
        )
    return tools


def _compact_for_llm(result: dict[str, Any]) -> str:
    """Strip bulky arrays before feeding a tool result back into the LLM context."""
    slim = dict(result)
    inner = slim.get("result")
    if isinstance(inner, dict):
        inner = {k: v for k, v in inner.items() if k not in {"mask", "mask_grid", "embedding", "features"}}
        slim["result"] = inner
    text = json.dumps(slim, ensure_ascii=False)
    return text[:4000]


# --------------------------------------------------------------------------- #
# real mode — single OpenAI function-calling agent loop
# --------------------------------------------------------------------------- #

def _run_agent(query: str, image_ref: str | None, emit: Emit) -> None:
    from openai import OpenAI  # noqa: PLC0415

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], base_url=os.environ.get("OPENAI_BASE_URL"))
    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    tools = _openai_tools()

    system = (
        "你是遥感分析智能体。根据用户请求（可能附带一张卫星/SAR 图像）决定调用哪些遥感模型工具完成分析，"
        "可多轮调用工具；拿到工具结果后用简洁、可执行的中文给出研判结论。"
        + (
            "用户已附加一张图像；调用图像类工具时无需也不要指定 image 参数，系统会自动注入。"
            if image_ref
            else "用户未附加图像；这些模型工具均需影像输入，若无合适工具可直接说明并给出建议。"
        )
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": query},
    ]

    for round_i in range(MAX_TOOL_ROUNDS + 1):
        final_turn = round_i == MAX_TOOL_ROUNDS
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice="none" if final_turn else "auto",
        )
        msg = resp.choices[0].message
        if not msg.tool_calls:
            emit("text", {"text": msg.content or ""})
            return

        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in msg.tool_calls
                ],
            }
        )
        for tc in msg.tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _safe_call(name, args, image_ref)
            emit("tool", {"name": name, "args": args, "result": result})
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": _compact_for_llm(result)})


# --------------------------------------------------------------------------- #
# mock mode — deterministic single-agent flow (no LLM key)
# --------------------------------------------------------------------------- #

def _run_mock(query: str, image_ref: str | None, emit: Emit) -> None:
    if image_ref:
        emit("text", {"text": f"已收到任务「{query}」并附带图像，调用遥感模型工具分析……"})
        calls = [
            ("dofa", {"task": "segment", "dataset_head": _DEFAULT_DOFA_HEAD}),
            ("sattxt", {"task": "zero_shot_classify", "text": ["机场跑道", "港口码头", "农田", "城市建筑群", "森林", "云层覆盖"]}),
        ]
    else:
        # Text-only: still demonstrate the loop with one visible tool call. The
        # model wrappers all need an image, so this honestly surfaces that.
        emit("text", {"text": f"已收到任务「{query}」，未附带图像；尝试调用模型工具以确认所需输入……"})
        calls = [("skyeyegpt", {"task": "caption", "image": ""})]

    results: list[tuple[str, dict[str, Any]]] = []
    for name, args in calls:
        result = _safe_call(name, args, image_ref)
        emit("tool", {"name": name, "args": args, "result": result})
        results.append((name, result))

    emit("text", {"text": _summarize_mock(query, results, has_image=bool(image_ref))})


def _summarize_mock(query: str, results: list[tuple[str, dict[str, Any]]], *, has_image: bool) -> str:
    lines = [f"【研判结论】针对请求「{query}」："]
    any_ok = False
    for name, res in results:
        if res.get("ok"):
            any_ok = True
            inner = res.get("result", {})
            keys = ", ".join(list(inner.keys())[:6]) if isinstance(inner, dict) else ""
            lines.append(f"- {name}：调用成功（{keys}）。")
        else:
            lines.append(f"- {name}：{res.get('error', '未能执行')}")
    if not has_image:
        lines.append("提示：遥感模型工具均需影像输入，请附加卫星 / SAR 图像后重试。")
    if not any_ok:
        lines.append("（当前为无 LLM key 的确定性演示模式；设置 OPENAI_API_KEY 后将由单智能体自主规划并调用可用模型工具。）")
    return "\n".join(lines)
