"""The 5 Magnetic-One-style agents, one CrewAI `Agent` per orchestration "Task"
from the slide diagram:

    Task Planner -> Execution Graph Generator -> Agent Executor
        -> Integration Agent -> Verify Agent --(feedback)--> Task Planner

Each `build_*_agent()` returns a `crewai.Agent`; `agent.py` (this module's
caller, `magnetic.py`) wraps each in a single-task `Crew` so it can be invoked
individually inside the outer Magnetic-One loop (CrewAI's `Process.sequential`
/ `Process.hierarchical` don't natively support the verify-then-replan loop).

Only imported when `OPENAI_API_KEY` is set (real mode) — `magnetic.py`'s mock
mode never touches CrewAI/LLMs.
"""

from __future__ import annotations


def build_task_planner_agent():
    from crewai import Agent  # noqa: PLC0415

    return Agent(
        role="任务规划员 Task Planner",
        goal="将用户的卫星/遥感分析请求拆解为结构化任务清单（Task Ledger）：已知事实、待验证假设、分步计划。",
        backstory="多智能体编排系统的总规划者，参考 Magnetic-One 的 Task Ledger 范式，输出严格 JSON。",
        verbose=False,
    )


def build_execution_graph_agent():
    from crewai import Agent  # noqa: PLC0415

    return Agent(
        role="执行图生成员 Execution Graph Generator",
        goal="将任务规划员的计划转换为可执行的有向执行图：节点=具体模型工具调用（skyeyegpt/sarmae/dofa/sattxt/mtp），边=依赖关系。",
        backstory="精通 model_wrappers 工具集的图编排专家，输出严格 JSON 执行图。",
        verbose=False,
    )


def build_agent_executor_agent(tools: list):
    from crewai import Agent  # noqa: PLC0415

    return Agent(
        role="执行智能体 Agent Executor",
        goal="按执行图依次调用 model_wrappers 工具（遥感模型），收集每个节点的真实输出。",
        backstory="负责实际调用 SkyEyeGPT / SARMAE / DOFA / SATtxt / MTP 等模型工具的执行者。",
        tools=tools,
        verbose=False,
    )


def build_integration_agent():
    from crewai import Agent  # noqa: PLC0415

    return Agent(
        role="整合智能体 Integration Agent",
        goal="综合执行图各节点的模型输出与原始任务规划，生成面向操作员的中文研判报告。",
        backstory="情报整合专家，擅长把多模型的结构化输出融合为简洁、可执行的结论。",
        verbose=False,
    )


def build_verify_agent():
    from crewai import Agent  # noqa: PLC0415

    return Agent(
        role="验证智能体 Verify Agent",
        goal="检查整合报告是否充分回应了用户的原始请求；若不充分，给出具体反馈以便任务规划员重新规划。",
        backstory="质量把关者，输出严格 JSON：{\"pass\": bool, \"feedback\": str}。",
        verbose=False,
    )
