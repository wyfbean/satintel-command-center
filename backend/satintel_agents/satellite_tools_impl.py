"""Deterministic satellite-image / geospatial tool implementations.

These pure functions are the single source of truth for the bundled MCP server
(`mcp_server/server.py`, used by the real CrewAI crew) AND for the deterministic
mock-mode run in `agui.py`. They return structured, plausible results without any
network or model dependency, so the chat shows genuine tool-call results offline.
Swap these bodies for real CV / catalog calls (SAM, object detectors, CelesTrak)
without changing the tool contracts.
"""

from __future__ import annotations

import hashlib
from typing import Any

_PALETTE = ["#3d74ff", "#15803d", "#dc2626", "#f97316", "#7c3aed", "#0891b2"]
_LABELS = ["跑道/机场", "港口船舶", "建筑群", "农田", "云层", "道路网", "水体", "植被"]


def _seed(ref: str) -> int:
    return int(hashlib.sha256(ref.encode("utf-8")).hexdigest(), 16)


def segment_image(image_ref: str, max_regions: int = 4) -> dict[str, Any]:
    """Mock semantic segmentation: return labeled regions with polygons + scores."""
    s = _seed(image_ref or "image")
    n = 2 + (s % max(1, max_regions - 1))
    regions = []
    for i in range(n):
        r = _seed(f"{image_ref}:{i}")
        x = 6 + (r % 60)
        y = 6 + ((r >> 8) % 60)
        w = 14 + ((r >> 16) % 28)
        h = 12 + ((r >> 24) % 26)
        regions.append(
            {
                "label": _LABELS[r % len(_LABELS)],
                # normalized 0-100 viewport coords so the frontend can overlay on any image
                "bbox": [x, y, min(96, x + w), min(96, y + h)],
                "color": _PALETTE[i % len(_PALETTE)],
                "score": round(0.62 + (r % 36) / 100, 2),
            }
        )
    return {"tool": "segment_image", "image_ref": image_ref, "regions": regions, "count": len(regions)}


def detect_objects(image_ref: str) -> dict[str, Any]:
    """Mock object detection over a satellite image."""
    s = _seed(image_ref or "image")
    classes = ["aircraft", "vessel", "vehicle", "storage-tank", "bridge"]
    n = 1 + (s % 4)
    objs = []
    for i in range(n):
        r = _seed(f"det:{image_ref}:{i}")
        objs.append(
            {
                "class": classes[r % len(classes)],
                "confidence": round(0.55 + (r % 44) / 100, 2),
                "centroid": [round((r % 100), 1), round(((r >> 7) % 100), 1)],
            }
        )
    return {"tool": "detect_objects", "image_ref": image_ref, "objects": objs, "count": len(objs)}


def tle_lookup(satellite: str) -> dict[str, Any]:
    """Mock orbital-element lookup for a named satellite (placeholder for CelesTrak)."""
    s = _seed(satellite or "sat")
    inclination = round(45 + (s % 540) / 10, 2)
    alt = 500 + (s % 35000)
    return {
        "tool": "tle_lookup",
        "satellite": satellite,
        "norad_id": 40000 + (s % 9000),
        "inclination_deg": inclination,
        "altitude_km": alt,
        "regime": "LEO" if alt < 2000 else "MEO" if alt < 30000 else "GEO",
    }


def geo_locate(query: str) -> dict[str, Any]:
    """Mock geocoder turning a place description into a lat/lon (placeholder)."""
    s = _seed(query or "loc")
    lat = round(((s % 18000) / 100) - 90, 4)
    lon = round((((s >> 12) % 36000) / 100) - 180, 4)
    return {"tool": "geo_locate", "query": query, "lat": lat, "lon": lon}


# Registry used by both the MCP server and the deterministic mock run.
TOOLS = {
    "segment_image": segment_image,
    "detect_objects": detect_objects,
    "tle_lookup": tle_lookup,
    "geo_locate": geo_locate,
}
