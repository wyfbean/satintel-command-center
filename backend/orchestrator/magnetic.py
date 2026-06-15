"""Magnetic-One-style orchestration loop.

Outer loop (max `MAX_ITERATIONS`), 5 "Task" stages per the slide diagram:

    1. Task Planner            -> Task Ledger JSON {facts, plan}
    2. Execution Graph Generator -> Execution Graph JSON {nodes, edges}
    3. Agent Executor          -> runs each node's model_wrappers tool, collects results
    4. Integration Agent       -> Chinese research report (text)
    5. Verify Agent            -> {pass, feedback}; if not pass, feedback feeds
                                   back into the Task Planner for the next iteration.

`run_magnetic(query, image_ref, emit)` is synchronous (invoked via a thread by
`agui_bridge.py`); it calls `emit(kind, payload)` for `text` / `tool` events and
finally `emit("__done__", {})` — mirroring `satintel_agents/crew.py`'s contract.

Two modes:
  - **mock** (default, no OPENAI_API_KEY): deterministic stage outputs; the
    Agent Executor still calls the REAL `model_wrappers.dofa` /
    `model_wrappers.sattxt` backends when an image is attached.
  - **real** (OPENAI_API_KEY set): each stage is a single-task CrewAI `Crew`
    (see `agents.py`); the Agent Executor's CrewAI agent is given MCP tools
    from `model_wrappers/mcp_server.py` via `MCPServerAdapter`.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable

Emit = Callable[[str, dict[str, Any]], None]

MAX_ITERATIONS = 2

EXECUTION_GRAPH_SCHEMA_HINT = (
    '{"nodes": [{"id": str, "tool": "skyeyegpt|sarmae|dofa|sattxt|mtp", "args": {...}}], '
    '"edges": [[from_id, to_id], ...]}'
)


def _llm_configured() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def run_magnetic(query: str, image_ref: str | None, emit: Emit) -> None:
    if _llm_configured():
        try:
            _run_real(query, image_ref, emit)
            emit("__done__", {})
            return
        except Exception as exc:  # noqa: BLE001 - degrade to mock on any real-mode failure
            emit("text", {"text": f"（实时编排不可用，回退到确定性演示：{exc}）"})
    _run_mock(query, image_ref, emit)
    emit("__done__", {})


# --------------------------------------------------------------------------- #
# mock mode
# --------------------------------------------------------------------------- #

def _run_mock(query: str, image_ref: str | None, emit: Emit) -> None:
    has_image = bool(image_ref)

    for iteration in range(1, MAX_ITERATIONS + 1):
        feedback = "" if iteration == 1 else "请补充基于附加图像的模型分析结果。"

        # 1. Task Planner
        emit("text", {"text": f"【任务规划员 Task Planner · 第{iteration}轮】解析请求「{query}」……"})
        plan = {
            "facts": [
                f"用户请求: {query}",
                "附带卫星图像，可调用影像类模型工具" if has_image else "未附带图像，仅可进行文本/知识性分析",
            ],
            "plan": (
                ["调用 DOFA 对附加图像进行多光谱语义分割", "调用 SATtxt 对附加图像进行零样本场景分类", "整合两者结果形成研判"]
                if has_image
                else ["基于请求文本给出研判建议（无影像工具可调用）"]
            ),
            "feedback_applied": feedback,
        }
        emit("tool", {"name": "task_planner", "args": {"query": query, "feedback": feedback}, "result": plan})

        # 2. Execution Graph Generator
        emit("text", {"text": "【执行图生成员 Execution Graph Generator】构建执行图……"})
        if has_image:
            graph = {
                "nodes": [
                    {"id": "n1", "tool": "dofa", "args": {"image": image_ref, "task": "segment", "dataset_head": "m-chesapeake"}},
                    {"id": "n2", "tool": "sattxt", "args": {"image": image_ref, "task": "zero_shot_classify", "text": ["机场跑道", "港口码头", "农田", "城市建筑群", "森林", "云层覆盖"]}},
                ],
                "edges": [],
            }
        else:
            graph = {"nodes": [], "edges": []}
        emit("tool", {"name": "execution_graph_generator", "args": {"plan": plan["plan"]}, "result": graph})

        # 3. Agent Executor
        emit("text", {"text": "【执行智能体 Agent Executor】调用 model_wrappers 工具……"})
        node_results: dict[str, dict[str, Any]] = {}
        if has_image:
            from model_wrappers import dofa, sattxt  # noqa: PLC0415

            for node in graph["nodes"]:
                args = node["args"]
                if node["tool"] == "dofa":
                    res = dofa(**args)
                elif node["tool"] == "sattxt":
                    res = sattxt(**args)
                else:
                    res = {"ok": False, "model": node["tool"], "task": args.get("task", ""), "error": "tool not wired in mock executor"}
                node_results[node["id"]] = res
                emit("tool", {"name": node["tool"], "args": args, "result": res})
        else:
            emit("text", {"text": "（无附加图像，跳过模型工具调用）"})

        # 4. Integration Agent
        emit("text", {"text": "【整合智能体 Integration Agent】综合结果生成研判……"})
        report = _integrate_mock(query, plan, node_results, has_image)
        emit("tool", {"name": "integration_agent", "args": {}, "result": {"report": report}})

        # 5. Verify Agent
        verdict = {"pass": True, "feedback": ""} if (has_image or iteration > 1) else {"pass": iteration >= MAX_ITERATIONS, "feedback": "建议附加卫星图像以启用模型分析。"}
        emit("text", {"text": f"【验证智能体 Verify Agent】{'通过' if verdict['pass'] else '未通过，将重新规划'}{('：' + verdict['feedback']) if verdict['feedback'] else ''}"})
        emit("tool", {"name": "verify_agent", "args": {}, "result": verdict})

        if verdict["pass"]:
            emit("text", {"text": report})
            break


def _integrate_mock(query: str, plan: dict[str, Any], node_results: dict[str, dict[str, Any]], has_image: bool) -> str:
    if not has_image:
        return (
            f"【研判报告】针对请求「{query}」：当前未附带卫星图像，无法调用 DOFA/SATtxt/SkyEyeGPT 等影像模型。"
            "建议：1) 附加卫星图像后重新提问以获得分割与场景分类结果；2) 如需轨道/目录类信息，"
            "可切换至「卫星智能体分析」（CrewAI）对话获取知识图谱检索结果。"
        )

    parts = [f"【研判报告】针对请求「{query}」，已调用以下模型工具："]
    for res in node_results.values():
        model = res.get("model", "?")
        if res.get("ok"):
            r = res.get("result", {})
            if model == "dofa":
                parts.append(f"- DOFA（{r.get('dataset_head')}）：多光谱编码器分割出 {r.get('num_classes')} 类区域（{r.get('head_source', '')}）。")
            elif model == "sattxt":
                preds = r.get("predictions", [])
                top = preds[0] if preds else {}
                parts.append(f"- SATtxt（RemoteCLIP）：零样本场景分类最高置信类别为「{top.get('label', '?')}」（{top.get('score', 0):.2%}）。")
            else:
                parts.append(f"- {model}: {json.dumps(r, ensure_ascii=False)}")
        else:
            parts.append(f"- {model}: 未能执行（{res.get('error', '未知错误')}）")
    parts.append("综合以上结果，建议结合分割区域与场景类别进一步核实目标区域用途。")
    return "\n".join(parts)


# --------------------------------------------------------------------------- #
# real mode (CrewAI; best-effort, lazy import)
# --------------------------------------------------------------------------- #

def _run_single_task(agent, description: str, expected_output: str, inputs: dict[str, Any] | None = None) -> str:
    from crewai import Crew, Process, Task  # noqa: PLC0415

    task = Task(description=description, expected_output=expected_output, agent=agent)
    crew = Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False)
    result = crew.kickoff(inputs=inputs or {})
    return str(getattr(result, "raw", result))


def _parse_json_loose(text: str, fallback: dict[str, Any]) -> dict[str, Any]:
    text = text.strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    return fallback


def _run_real(query: str, image_ref: str | None, emit: Emit) -> None:
    from crewai_tools import MCPServerAdapter  # noqa: PLC0415

    from . import agents as A  # noqa: PLC0415

    _backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    mcp_module = os.path.join(_backend_root, "model_wrappers", "mcp_server.py")

    from mcp import StdioServerParameters  # noqa: PLC0415

    mcp_params = StdioServerParameters(command="python", args=[mcp_module], env=os.environ.copy())

    feedback = ""
    with MCPServerAdapter(mcp_params) as model_tools:
        for iteration in range(1, MAX_ITERATIONS + 1):
            emit("text", {"text": f"【任务规划员 Task Planner · 第{iteration}轮】解析请求「{query}」……"})
            planner_out = _run_single_task(
                A.build_task_planner_agent(),
                description=(
                    f"用户请求：「{query}」。{'已附加卫星图像：' + image_ref if image_ref else '未附加图像。'}"
                    f"{'此前验证反馈：' + feedback if feedback else ''}"
                    "输出严格 JSON：{\"facts\": [...], \"plan\": [...]}。"
                ),
                expected_output="严格 JSON 格式的任务清单",
            )
            plan = _parse_json_loose(planner_out, {"facts": [], "plan": [query]})
            emit("tool", {"name": "task_planner", "args": {"query": query}, "result": plan})

            emit("text", {"text": "【执行图生成员 Execution Graph Generator】构建执行图……"})
            graph_out = _run_single_task(
                A.build_execution_graph_agent(),
                description=(
                    f"基于任务计划 {json.dumps(plan, ensure_ascii=False)}，"
                    f"{'图像引用为 ' + image_ref + '。' if image_ref else '没有图像可用，节点列表应为空。'}"
                    f"输出严格 JSON 执行图，格式：{EXECUTION_GRAPH_SCHEMA_HINT}。"
                    "可用工具：skyeyegpt（图像描述/VQA/对话/定位）、sarmae（SAR检测/分割）、"
                    "dofa（多光谱分割，需 dataset_head）、sattxt（零样本分类/图文检索）、mtp（RGB目标检测）。"
                ),
                expected_output="严格 JSON 格式的执行图",
            )
            graph = _parse_json_loose(graph_out, {"nodes": [], "edges": []})
            emit("tool", {"name": "execution_graph_generator", "args": {}, "result": graph})

            emit("text", {"text": "【执行智能体 Agent Executor】调用 model_wrappers 工具……"})
            executor = A.build_agent_executor_agent(list(model_tools))
            exec_out = _run_single_task(
                executor,
                description=(
                    f"按照执行图 {json.dumps(graph, ensure_ascii=False)} 依次调用对应的 model_wrappers MCP 工具，"
                    "并汇总每个节点的真实返回结果（JSON）。"
                ),
                expected_output="每个执行图节点的工具调用结果摘要",
            )
            emit("tool", {"name": "agent_executor", "args": {}, "result": {"summary": exec_out}})

            emit("text", {"text": "【整合智能体 Integration Agent】综合结果生成研判……"})
            report = _run_single_task(
                A.build_integration_agent(),
                description=(
                    f"原始请求：「{query}」。任务计划：{json.dumps(plan, ensure_ascii=False)}。"
                    f"执行结果：{exec_out}。请输出简洁中文研判报告。"
                ),
                expected_output="中文研判报告",
            )
            emit("tool", {"name": "integration_agent", "args": {}, "result": {"report": report}})

            emit("text", {"text": "【验证智能体 Verify Agent】检查研判是否充分回应原始请求……"})
            verify_out = _run_single_task(
                A.build_verify_agent(),
                description=(
                    f"原始请求：「{query}」。研判报告：{report}。"
                    "判断报告是否充分回应了原始请求，输出严格 JSON：{\"pass\": bool, \"feedback\": str}。"
                ),
                expected_output="严格 JSON 格式的验证结果",
            )
            verdict = _parse_json_loose(verify_out, {"pass": True, "feedback": ""})
            emit("tool", {"name": "verify_agent", "args": {}, "result": verdict})

            if verdict.get("pass", True):
                emit("text", {"text": report})
                return
            feedback = verdict.get("feedback", "")
            emit("text", {"text": f"未通过验证，反馈：{feedback}，重新规划……"})
