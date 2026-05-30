"""Real CrewAI crew for satellite-scene analysis + a streaming bridge.

Runs only when `OPENAI_API_KEY` is set (see `agui.py`); otherwise the deterministic
mock run is used. Authored against the official CrewAI guides:
- multimodal agent: `Agent(multimodal=True)` (auto `AddImageTool`)
- MCP tools: `crewai_tools.MCPServerAdapter` connected to the bundled stdio server
- streaming: a `BaseEventListener` on the event bus forwarding tool/agent events

`run_crew_streaming(query, image_ref, emit)` is synchronous (invoked via a thread by
the async AG-UI bridge); it calls `emit(kind, payload)` for `text` / `tool` events and
finally `emit("__done__", {})`.
"""

from __future__ import annotations

import os
from typing import Any, Callable

_MCP_SERVER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mcp_server", "server.py")

Emit = Callable[[str, dict[str, Any]], None]


def _mcp_params():
    from mcp import StdioServerParameters  # noqa: PLC0415

    return StdioServerParameters(command="python", args=[_MCP_SERVER], env=os.environ.copy())


def _make_listener(emit: Emit):
    """A BaseEventListener that forwards CrewAI tool/agent events to `emit`."""
    from crewai.events import (  # noqa: PLC0415
        AgentExecutionStartedEvent,
        BaseEventListener,
        ToolUsageFinishedEvent,
    )

    class _Forwarder(BaseEventListener):
        def setup_listeners(self, bus):  # noqa: ANN001
            @bus.on(AgentExecutionStartedEvent)
            def _on_agent(_source, event):  # noqa: ANN001
                role = getattr(getattr(event, "agent", None), "role", "agent")
                emit("text", {"text": f"【{role}】开始执行……"})

            @bus.on(ToolUsageFinishedEvent)
            def _on_tool(_source, event):  # noqa: ANN001
                name = getattr(event, "tool_name", "tool")
                output = getattr(event, "output", None)
                emit("tool", {"name": name, "args": getattr(event, "tool_args", {}) or {}, "result": {"output": str(output)}})

    return _Forwarder()


def run_crew_streaming(query: str, image_ref: str | None, emit: Emit) -> None:
    from crewai import Agent, Crew, Process, Task  # noqa: PLC0415
    from crewai_tools import MCPServerAdapter  # noqa: PLC0415

    listener = _make_listener(emit)  # registers handlers on instantiation
    _ = listener

    with MCPServerAdapter(_mcp_params()) as mcp_tools:
        coordinator = Agent(
            role="任务协调员",
            goal="拆解用户的卫星分析任务并安排合适的工具与智能体。",
            backstory="资深卫星情报协调员，擅长把模糊请求转化为可执行的分析步骤。",
            verbose=False,
        )
        image_analyst = Agent(
            role="影像分析师",
            goal="对卫星图像进行视觉问答与目标/区域识别。",
            backstory="遥感影像解译专家。",
            multimodal=True,
            tools=list(mcp_tools),
            verbose=False,
        )
        reporter = Agent(
            role="报告员",
            goal="综合各智能体与工具的结果，输出简洁的中文研判。",
            backstory="情报简报撰写专家。",
            verbose=False,
        )

        image_hint = f"图像引用：{image_ref}" if image_ref else "无附带图像，使用地理/轨道工具。"
        analyze = Task(
            description=f"针对用户请求「{query}」进行分析。{image_hint} 调用可用的 MCP 工具获取证据。",
            expected_output="结构化的分析证据（检测/分割/地理/轨道结果）。",
            agent=image_analyst,
        )
        report = Task(
            description="基于分析证据，输出面向操作员的中文研判与下一步建议。",
            expected_output="简洁中文研判。",
            agent=reporter,
        )

        crew = Crew(
            agents=[coordinator, image_analyst, reporter],
            tasks=[analyze, report],
            process=Process.sequential,
            verbose=False,
        )
        result = crew.kickoff(inputs={"query": query, "image_ref": image_ref or ""})
        emit("text", {"text": str(getattr(result, "raw", result))})
    emit("__done__", {})
