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

_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PROJECT_ROOT = os.path.dirname(_BACKEND_ROOT)

# Existing image-tools MCP server (runs under backend's Python 3.13 venv)
_MCP_SERVER = os.path.join(_BACKEND_ROOT, "mcp_server", "server.py")

# KG MCP server (runs under root .venv Python 3.12 where kuzu is installed)
_KG_SERVER = os.path.join(_PROJECT_ROOT, "kg", "kg_mcp_server.py")
_ROOT_PYTHON = os.path.join(_PROJECT_ROOT, ".venv", "Scripts", "python.exe")

Emit = Callable[[str, dict[str, Any]], None]


def _mcp_params():
    from mcp import StdioServerParameters  # noqa: PLC0415

    return StdioServerParameters(command="python", args=[_MCP_SERVER], env=os.environ.copy())


def _kg_mcp_params():
    from mcp import StdioServerParameters  # noqa: PLC0415

    return StdioServerParameters(command=_ROOT_PYTHON, args=[_KG_SERVER], env=os.environ.copy())


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

    with MCPServerAdapter(_mcp_params()) as image_tools:
        with MCPServerAdapter(_kg_mcp_params()) as kg_tools:
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
                tools=list(image_tools),
                verbose=False,
            )
            data_analyst = Agent(
                role="数据分析师",
                goal="通过知识图谱工具查询卫星轨道参数、运营商、发射历史等结构化数据。",
                backstory="卫星数据库专家，熟悉7500颗卫星的轨道与运营信息，擅长从知识图谱中检索精确数据。",
                tools=list(kg_tools),
                verbose=False,
            )
            reporter = Agent(
                role="报告员",
                goal="综合各智能体与工具的结果，输出简洁的中文研判。",
                backstory="情报简报撰写专家。",
                verbose=False,
            )

            image_hint = f"图像引用：{image_ref}" if image_ref else "无附带图像，优先使用数据查询工具。"
            tasks = []

            if image_ref:
                analyze = Task(
                    description=f"针对用户请求「{query}」进行影像分析。{image_hint} 调用影像 MCP 工具获取检测/分割证据。",
                    expected_output="结构化的影像分析证据（检测/分割结果）。",
                    agent=image_analyst,
                )
                tasks.append(analyze)

            retrieve = Task(
                description=f"针对用户请求「{query}」，通过卫星知识图谱工具检索相关卫星的轨道参数、运营商、发射信息。",
                expected_output="结构化的卫星数据（轨道参数、运营商、发射记录等）。",
                agent=data_analyst,
            )
            tasks.append(retrieve)

            report = Task(
                description="基于所有已收集的证据，输出面向操作员的中文研判与下一步建议。",
                expected_output="简洁中文研判。",
                agent=reporter,
            )
            tasks.append(report)

            crew = Crew(
                agents=[coordinator, image_analyst, data_analyst, reporter],
                tasks=tasks,
                process=Process.sequential,
                verbose=False,
            )
            result = crew.kickoff(inputs={"query": query, "image_ref": image_ref or ""})
            emit("text", {"text": str(getattr(result, "raw", result))})
    emit("__done__", {})
