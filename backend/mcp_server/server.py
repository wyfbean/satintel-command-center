"""Bundled satellite-themed MCP server (stdio transport).

Exposes the satellite tools as MCP tools so the real CrewAI crew can call them via
`MCPServerAdapter` and the results render in the chat. Self-contained — no external
services or keys. Launched as a subprocess: `python mcp_server/server.py`.
"""

from __future__ import annotations

import os
import sys

# Allow importing the shared tool implementations when run as a standalone script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mcp.server.fastmcp import FastMCP  # noqa: E402

from satintel_agents.satellite_tools_impl import (  # noqa: E402
    detect_objects as _detect_objects,
    geo_locate as _geo_locate,
    segment_image as _segment_image,
    tle_lookup as _tle_lookup,
)

mcp = FastMCP("satellite-tools")


@mcp.tool()
def segment_image(image_ref: str) -> dict:
    """Semantic segmentation of a satellite image; returns labeled regions with polygons."""
    return _segment_image(image_ref)


@mcp.tool()
def detect_objects(image_ref: str) -> dict:
    """Detect objects (aircraft, vessels, vehicles, ...) in a satellite image."""
    return _detect_objects(image_ref)


@mcp.tool()
def tle_lookup(satellite: str) -> dict:
    """Look up orbital elements (NORAD id, inclination, altitude, regime) for a satellite."""
    return _tle_lookup(satellite)


@mcp.tool()
def geo_locate(query: str) -> dict:
    """Geocode a place description to latitude/longitude."""
    return _geo_locate(query)


if __name__ == "__main__":
    mcp.run(transport="stdio")
