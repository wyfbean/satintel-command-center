"""model_wrappers MCP server (stdio transport).

Exposes `skyeyegpt`, `sarmae`, `dofa`, `sattxt`, `mtp` as MCP tools (descriptions
+ input schemas from `schemas.TOOL_SCHEMAS`) so the Magnetic-One orchestrator's
Agent Executor (`orchestrator/`) — and, if desired, the existing `/orchestration`
CrewAI crew — can call the 5 remote-sensing models via `MCPServerAdapter`.

Launched as a subprocess: `python -m model_wrappers.mcp_server`.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mcp.server.fastmcp import FastMCP  # noqa: E402

from model_wrappers.remote_models import dofa, mtp, sarmae, sattxt, skyeyegpt  # noqa: E402
from model_wrappers.schemas import TOOL_SCHEMAS  # noqa: E402

mcp = FastMCP("model-wrappers")


@mcp.tool(description=TOOL_SCHEMAS["skyeyegpt"]["description"])
def skyeyegpt_tool(image: str, task: str, prompt: str | None = None) -> dict:
    return skyeyegpt(image=image, task=task, prompt=prompt)


@mcp.tool(description=TOOL_SCHEMAS["sarmae"]["description"])
def sarmae_tool(image: str, task: str = "detect") -> dict:
    return sarmae(image=image, task=task)


@mcp.tool(description=TOOL_SCHEMAS["dofa"]["description"])
def dofa_tool(image: str, dataset_head: str, task: str = "segment") -> dict:
    return dofa(image=image, task=task, dataset_head=dataset_head)


@mcp.tool(description=TOOL_SCHEMAS["sattxt"]["description"])
def sattxt_tool(task: str, image: str | None = None, text: str | list[str] | None = None) -> dict:
    return sattxt(task=task, image=image, text=text)


@mcp.tool(description=TOOL_SCHEMAS["mtp"]["description"])
def mtp_tool(image: str, task: str = "detect", score_thr: float = 0.3) -> dict:
    return mtp(image=image, task=task, score_thr=score_thr)


if __name__ == "__main__":
    mcp.run(transport="stdio")
