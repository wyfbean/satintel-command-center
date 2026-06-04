"""Satellite Knowledge Graph MCP server (stdio transport).

Runs under the root .venv (Python 3.12) where kuzu is installed.
Launched as a subprocess by the CrewAI backend via MCPServerAdapter.

Usage (standalone test):
    .venv\\Scripts\\python.exe kg\\kg_mcp_server.py

Requires: kuzu, fastmcp  (installed via uv pip into root .venv)
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import kuzu
from fastmcp import FastMCP

ROOT = Path(__file__).resolve().parent.parent

# Kuzu's C++ backend doesn't support non-ASCII Windows paths.
# Must match the path used by ingest.py.  Override with SAT_KG_PATH env var.
import os as _os
DB_PATH = Path(_os.environ.get("SAT_KG_PATH", str(Path.home() / ".sat-kg")))

mcp = FastMCP(
    "satellite-kg",
    instructions=(
        "Satellite Knowledge Graph with 7,500+ orbital satellites. "
        "Use get_satellite() for single lookups, query_satellites() for filtered lists, "
        "satellites_by_vehicle() / satellites_by_operator() for relationship queries, "
        "and graph_stats() to understand the scope of available data."
    ),
)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _open_db() -> kuzu.Connection:
    if not DB_PATH.exists():
        raise RuntimeError(
            f"KG database not found at {DB_PATH}. "
            "Run: .venv\\Scripts\\python.exe kg\\ingest.py"
        )
    db = kuzu.Database(str(DB_PATH), read_only=True)
    return kuzu.Connection(db)


def _rows(result: Any) -> list[dict]:
    """Convert a kuzu QueryResult to a list of plain dicts."""
    cols = result.get_column_names()
    out: list[dict] = []
    while result.has_next():
        row = result.get_next()
        out.append(dict(zip(cols, row)))
    return out


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@mcp.tool()
def get_satellite(name: str) -> dict:
    """Look up a satellite's full profile by name, NORAD number, or COSPAR ID.

    Performs a case-insensitive substring match against the official name and
    alternate names, plus exact match on NORAD/COSPAR. Returns up to 5 results
    including orbital parameters, operator, and contractor.
    """
    conn = _open_db()
    q = """
        MATCH (s:Satellite)
        WHERE lower(s.name) CONTAINS $q
           OR lower(s.alt_names) CONTAINS $q
           OR s.norad = $exact
           OR s.cospar = $exact
        RETURN
            s.sat_id     AS sat_id,
            s.name       AS name,
            s.norad      AS norad,
            s.cospar     AS cospar,
            s.orbit_class AS orbit_class,
            s.orbit_type  AS orbit_type,
            s.perigee_km  AS perigee_km,
            s.apogee_km   AS apogee_km,
            s.inclination AS inclination_deg,
            s.period_min  AS period_min,
            s.geo_lon     AS geo_lon,
            s.launch_date AS launch_date,
            s.expected_lifetime_yrs AS expected_lifetime_yrs,
            s.launch_mass_kg AS launch_mass_kg,
            s.power_w     AS power_w,
            s.users       AS users,
            s.comments    AS comments
        LIMIT 5
    """
    satellites = _rows(conn.execute(q, {"q": name.lower().strip(), "exact": name.strip()}))

    if not satellites:
        return {"tool": "get_satellite", "query": name, "found": False, "results": []}

    # Enrich each result with operator and contractor relationships
    for sat in satellites:
        sid = sat["sat_id"]
        sat["operators"] = [
            r["op_name"]
            for r in _rows(conn.execute(
                "MATCH (s:Satellite {sat_id: $sid})-[:OPERATED_BY]->(o:Organization) "
                "RETURN o.name AS op_name",
                {"sid": sid},
            ))
        ]
        sat["contractors"] = [
            r["c_name"]
            for r in _rows(conn.execute(
                "MATCH (s:Satellite {sat_id: $sid})-[:BUILT_BY]->(o:Organization) "
                "RETURN o.name AS c_name",
                {"sid": sid},
            ))
        ]
        sat["purposes"] = [
            r["p_name"]
            for r in _rows(conn.execute(
                "MATCH (s:Satellite {sat_id: $sid})-[:HAS_PURPOSE]->(p:Purpose) "
                "RETURN p.name AS p_name",
                {"sid": sid},
            ))
        ]

    return {"tool": "get_satellite", "query": name, "found": True, "results": satellites}


@mcp.tool()
def query_satellites(
    country: str = "",
    orbit_class: str = "",
    purpose: str = "",
    operator: str = "",
    launched_after: str = "",
    launched_before: str = "",
    limit: int = 20,
) -> dict:
    """Query satellites by multiple filter criteria.

    All parameters are optional; combine freely.
    - country: operator's country, substring match (e.g. 'China', 'USA', 'France')
    - orbit_class: 'LEO', 'GEO', or 'MEO'
    - purpose: e.g. 'Earth Observation', 'Communications', 'Navigation'
    - operator: organization name substring (e.g. 'ESA', 'SpaceX', 'ISRO')
    - launched_after / launched_before: ISO date 'YYYY-MM-DD'
    - limit: max results (default 20, max 100)

    Returns satellite name, NORAD, orbit, and launch date for each match.
    """
    conn = _open_db()
    limit = min(int(limit), 100)

    # Build query dynamically — add MATCH clauses only for active filters
    match_clauses = ["MATCH (s:Satellite)"]
    where_parts: list[str] = []
    params: dict[str, Any] = {"limit": limit}

    if country:
        match_clauses.append("MATCH (s)-[:OPERATOR_COUNTRY]->(c:Country)")
        where_parts.append("lower(c.name) CONTAINS $country")
        params["country"] = country.lower()

    if purpose:
        match_clauses.append("MATCH (s)-[:HAS_PURPOSE]->(p:Purpose)")
        where_parts.append("lower(p.name) CONTAINS $purpose")
        params["purpose"] = purpose.lower()

    if operator:
        match_clauses.append("MATCH (s)-[:OPERATED_BY]->(op:Organization)")
        where_parts.append("lower(op.name) CONTAINS $operator")
        params["operator"] = operator.lower()

    if orbit_class:
        where_parts.append("upper(s.orbit_class) = upper($orbit_class)")
        params["orbit_class"] = orbit_class

    if launched_after:
        where_parts.append("s.launch_date >= $after")
        params["after"] = launched_after

    if launched_before:
        where_parts.append("s.launch_date <= $before")
        params["before"] = launched_before

    where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    cypher = (
        "\n".join(match_clauses)
        + f"\n{where_clause}\n"
        + "RETURN DISTINCT s.name AS name, s.norad AS norad, "
        + "s.orbit_class AS orbit_class, s.orbit_type AS orbit_type, "
        + "s.launch_date AS launch_date, s.perigee_km AS perigee_km, "
        + "s.apogee_km AS apogee_km, s.users AS users\n"
        + "ORDER BY s.launch_date DESC\n"
        + "LIMIT $limit"
    )

    results = _rows(conn.execute(cypher, params))
    return {
        "tool": "query_satellites",
        "filters": {
            "country": country,
            "orbit_class": orbit_class,
            "purpose": purpose,
            "operator": operator,
            "launched_after": launched_after,
            "launched_before": launched_before,
        },
        "count": len(results),
        "results": results,
    }


@mcp.tool()
def satellites_by_vehicle(vehicle: str, limit: int = 30) -> dict:
    """Find all satellites launched by a specific launch vehicle.

    Uses substring matching — 'Soyuz' matches Soyuz-2.1a, Soyuz-FG, etc.
    Returns satellite name, NORAD, orbit class, and launch date, sorted newest first.
    """
    conn = _open_db()
    limit = min(int(limit), 100)
    q = """
        MATCH (s:Satellite)-[:USES_VEHICLE]->(v:LaunchVehicle)
        WHERE lower(v.name) CONTAINS $vehicle
        RETURN
            s.name        AS name,
            s.norad       AS norad,
            s.orbit_class AS orbit_class,
            s.launch_date AS launch_date,
            v.name        AS vehicle,
            s.perigee_km  AS perigee_km,
            s.apogee_km   AS apogee_km
        ORDER BY s.launch_date DESC
        LIMIT $limit
    """
    results = _rows(conn.execute(q, {"vehicle": vehicle.lower(), "limit": limit}))
    return {
        "tool": "satellites_by_vehicle",
        "vehicle_query": vehicle,
        "count": len(results),
        "results": results,
    }


@mcp.tool()
def satellites_by_operator(
    operator: str,
    orbit_class: str = "",
    launched_after: str = "",
    limit: int = 30,
) -> dict:
    """Find satellites operated by a specific organization.

    - operator: substring match (e.g. 'ESA', 'Planet Labs', 'JAXA', 'NASA')
    - orbit_class: optional filter — 'LEO', 'GEO', or 'MEO'
    - launched_after: optional ISO date filter 'YYYY-MM-DD'
    - limit: max results (default 30)
    """
    conn = _open_db()
    limit = min(int(limit), 100)

    where_parts = ["lower(op.name) CONTAINS $operator"]
    params: dict[str, Any] = {"operator": operator.lower(), "limit": limit}

    if orbit_class:
        where_parts.append("upper(s.orbit_class) = upper($orbit_class)")
        params["orbit_class"] = orbit_class

    if launched_after:
        where_parts.append("s.launch_date >= $after")
        params["after"] = launched_after

    where_clause = " AND ".join(where_parts)
    q = (
        "MATCH (s:Satellite)-[:OPERATED_BY]->(op:Organization)\n"
        f"WHERE {where_clause}\n"
        "RETURN s.name AS name, s.norad AS norad, s.orbit_class AS orbit_class, "
        "s.launch_date AS launch_date, s.perigee_km AS perigee_km, "
        "s.apogee_km AS apogee_km, op.name AS operator\n"
        "ORDER BY s.launch_date DESC\n"
        "LIMIT $limit"
    )
    results = _rows(conn.execute(q, params))
    return {
        "tool": "satellites_by_operator",
        "operator_query": operator,
        "filters": {"orbit_class": orbit_class, "launched_after": launched_after},
        "count": len(results),
        "results": results,
    }


@mcp.tool()
def graph_stats() -> dict:
    """Return summary statistics of the satellite knowledge graph.

    Reports node counts per entity type and edge counts per relationship type.
    Useful for understanding the scope of available data before querying.
    """
    conn = _open_db()
    stats: dict[str, int] = {}

    for label in ["Satellite", "Organization", "Country", "LaunchSite", "LaunchVehicle", "Purpose"]:
        r = _rows(conn.execute(f"MATCH (n:{label}) RETURN count(n) AS cnt"))
        stats[label] = r[0]["cnt"] if r else 0

    for rel in ["OPERATED_BY", "BUILT_BY", "REGISTERED_IN", "OPERATOR_COUNTRY",
                "BASED_IN", "LAUNCHED_FROM", "USES_VEHICLE", "HAS_PURPOSE"]:
        r = _rows(conn.execute(f"MATCH ()-[r:{rel}]->() RETURN count(r) AS cnt"))
        stats[rel] = r[0]["cnt"] if r else 0

    return {"tool": "graph_stats", "stats": stats}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run()
