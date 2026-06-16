"""Contract test for the single-agent orchestrator (no LLM key / no torch needed).

Monkeypatches the OpenAI client and one model wrapper to verify the real-mode
loop in `orchestrator.magnetic`:
  1. TOOL_SCHEMAS → OpenAI tool defs with `image` hidden.
  2. attached image is injected into the tool call at execution time.
  3. the model wrapper runs and a TOOL AG-UI event is emitted with its result.
  4. the loop ends on a final assistant text turn.

Run: `cd backend && uv run python test_agent_contract.py`
"""

from __future__ import annotations

import os
import sys
import types

import orchestrator.magnetic as M

IMAGE_REF = "data:image/png;base64,AAAA"
_failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("PASS" if cond else "FAIL") + " - " + msg)
    if not cond:
        _failures.append(msg)


# --- 1. schema transform -------------------------------------------------------
tools = M._openai_tools()
by_name = {t["function"]["name"]: t["function"] for t in tools}
check({"skyeyegpt", "sarmae", "dofa", "sattxt", "mtp"} <= set(by_name), "all 5 tools exposed")
check(all(f.get("description") for f in by_name.values()), "every tool has a description")
check("image" not in by_name["dofa"]["parameters"].get("properties", {}), "dofa: `image` hidden from params")
check("image" not in by_name["dofa"]["parameters"].get("required", []), "dofa: `image` not in required")
check("dataset_head" in by_name["dofa"]["parameters"]["properties"], "dofa: dataset_head still exposed")

# --- 2/3. image injection + tool execution + event emission --------------------
recorded: dict[str, object] = {}


def fake_dofa(**kwargs):
    recorded.update(kwargs)
    return {"ok": True, "model": "dofa", "task": kwargs.get("task"), "result": {"num_classes": 2}, "meta": {}}


fake_rm = types.SimpleNamespace(dofa=fake_dofa)
sys.modules["model_wrappers.remote_models"] = fake_rm  # _safe_call does `from model_wrappers import remote_models`
sys.modules.setdefault("model_wrappers", types.ModuleType("model_wrappers"))
sys.modules["model_wrappers"].remote_models = fake_rm


def _msg(content, tool_calls=None):
    tcs = None
    if tool_calls:
        tcs = [
            types.SimpleNamespace(id=f"tc{i}", function=types.SimpleNamespace(name=n, arguments=a))
            for i, (n, a) in enumerate(tool_calls)
        ]
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=types.SimpleNamespace(content=content, tool_calls=tcs))])


class FakeCompletions:
    def __init__(self):
        self.calls = 0

    def create(self, **kwargs):
        self.calls += 1
        self.last_kwargs = kwargs
        if self.calls == 1:
            return _msg("", [("dofa", '{"task":"segment","dataset_head":"m-pv4ger-seg"}')])
        return _msg("分析完成：分割出 2 类区域。")


class FakeClient:
    def __init__(self, *a, **k):
        self.chat = types.SimpleNamespace(completions=FakeCompletions())


import openai  # noqa: E402

openai.OpenAI = FakeClient  # _run_agent does `from openai import OpenAI`
os.environ["OPENAI_API_KEY"] = "sk-test"

events: list[tuple[str, dict]] = []
M._run_agent("分割图中区域", IMAGE_REF, lambda kind, payload: events.append((kind, payload)))

tool_events = [p for k, p in events if k == "tool"]
text_events = [p for k, p in events if k == "text"]
check(len(tool_events) == 1 and tool_events[0]["name"] == "dofa", "exactly one dofa TOOL event emitted")
check(recorded.get("image") == IMAGE_REF, "attached image injected into tool call")
check(recorded.get("dataset_head") == "m-pv4ger-seg", "LLM-provided args passed through")
check("image" not in tool_events[0]["args"], "emitted args do not leak the image data URL")
check(tool_events[0]["result"]["ok"] is True, "tool result envelope forwarded")
check(bool(text_events) and "分析完成" in text_events[-1]["text"], "loop ends on a final assistant text turn")

print()
if _failures:
    print(f"{len(_failures)} FAILED")
    sys.exit(1)
print("ALL PASSED")
