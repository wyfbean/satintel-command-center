"""
ETL: satellite-KG.csv → Kuzu property-graph database at data/satellite-kg/

Run once (and again whenever the CSV is updated):
    .venv\\Scripts\\python.exe kg\\ingest.py

Requires: kuzu  (installed in root .venv via uv pip install kuzu)
"""
from __future__ import annotations

import csv
import re
import shutil
from pathlib import Path

import kuzu

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "satellite-KG.csv"

# Kuzu's C++ backend doesn't support non-ASCII Windows paths.
# Default to ~/.sat-kg (USERPROFILE has no Chinese chars on this machine).
# Override with SAT_KG_PATH env var if needed.
import os as _os
DB_PATH = Path(_os.environ.get("SAT_KG_PATH", str(Path.home() / ".sat-kg")))

# CSV has non-UTF-8 bytes (latin-1 characters in satellite names/comments)
ENCODING = "latin-1"

# Explicitly select the 28 meaningful columns; the CSV has 68 total with 40
# trailing blank / duplicate "Source" columns that pandas renames as Source.1…
MEANINGFUL_COLS = [
    "Name of Satellite, Alternate Names",
    "Current Official Name of Satellite",
    "Country/Org of UN Registry",
    "Country of Operator/Owner",
    "Operator/Owner",
    "Users",
    "Purpose",
    "Detailed Purpose",
    "Class of Orbit",
    "Type of Orbit",
    "Longitude of GEO (degrees)",
    "Perigee (km)",
    "Apogee (km)",
    "Eccentricity",
    "Inclination (degrees)",
    "Period (minutes)",
    "Launch Mass (kg.)",
    " Dry Mass (kg.) ",
    "Power (watts)",
    "Date of Launch",
    "Expected Lifetime (yrs.)",
    "Contractor",
    "Country of Contractor",
    "Launch Site",
    "Launch Vehicle",
    "COSPAR Number",
    "NORAD Number",
    "Comments",
]


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------

def _norm_name(s: str) -> str:
    """Strip whitespace, collapse internal spaces, remove trailing '?'."""
    return re.sub(r"\s+", " ", s.strip().rstrip("?")).strip()


def _parse_float(s: str) -> float | None:
    s = s.strip().replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_date(s: str) -> str | None:
    """'2022/4/29' → '2022-04-29' (ISO string for lexicographic comparison)."""
    s = s.strip()
    if not s:
        return None
    parts = s.split("/")
    if len(parts) == 3:
        try:
            return f"{int(parts[0]):04d}-{int(parts[1]):02d}-{int(parts[2]):02d}"
        except ValueError:
            return None
    return None


def _norm_orbit_class(s: str) -> str:
    """Normalise 'LEo' → 'LEO'; leave unknown values unchanged."""
    v = s.strip().upper()
    return v if v in ("LEO", "GEO", "MEO") else s.strip()


def _is_nr(s: str) -> bool:
    """True when UN Registry field means 'Not Registered' (NR / NR (4/22) etc.)."""
    return bool(re.match(r"^NR\b", s.strip(), re.IGNORECASE))


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------

def load_csv() -> list[dict]:
    """Load CSV rows, dedup on (norad, cospar), assign surrogate sat_id."""
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()

    with open(CSV_PATH, encoding=ENCODING) as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            row = {col: raw_row.get(col, "") for col in MEANINGFUL_COLS}

            # Skip trailing empty rows
            if not row["Current Official Name of Satellite"].strip() and not row["NORAD Number"].strip():
                continue

            # Dedup: the CSV contains 9 exact duplicate rows
            norad = row["NORAD Number"].strip()
            cospar = row["COSPAR Number"].strip()
            key = (norad, cospar)
            if key in seen:
                continue
            seen.add(key)

            row["_sat_id"] = len(rows)
            rows.append(row)

    return rows


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def build_graph(rows: list[dict]) -> None:
    # Remove old DB so we can re-run ingest cleanly; let Kuzu create its own directory
    if DB_PATH.exists():
        shutil.rmtree(DB_PATH)

    db = kuzu.Database(str(DB_PATH))
    conn = kuzu.Connection(db)

    # ------------------------------------------------------------------
    # DDL: node tables
    # ------------------------------------------------------------------
    conn.execute("""
        CREATE NODE TABLE Satellite (
            sat_id               INT64,
            norad                STRING,
            cospar               STRING,
            name                 STRING,
            alt_names            STRING,
            orbit_class          STRING,
            orbit_type           STRING,
            perigee_km           DOUBLE,
            apogee_km            DOUBLE,
            inclination          DOUBLE,
            period_min           DOUBLE,
            geo_lon              DOUBLE,
            launch_mass_kg       DOUBLE,
            dry_mass_kg          DOUBLE,
            power_w              DOUBLE,
            launch_date          STRING,
            expected_lifetime_yrs DOUBLE,
            users                STRING,
            comments             STRING,
            PRIMARY KEY (sat_id)
        )
    """)

    conn.execute("""
        CREATE NODE TABLE Organization (
            org_id     INT64,
            name       STRING,
            name_lower STRING,
            PRIMARY KEY (org_id)
        )
    """)

    conn.execute("""
        CREATE NODE TABLE Country (
            country_id INT64,
            name       STRING,
            name_lower STRING,
            PRIMARY KEY (country_id)
        )
    """)

    conn.execute("""
        CREATE NODE TABLE LaunchSite (
            site_id INT64,
            name    STRING,
            PRIMARY KEY (site_id)
        )
    """)

    conn.execute("""
        CREATE NODE TABLE LaunchVehicle (
            vehicle_id INT64,
            name       STRING,
            PRIMARY KEY (vehicle_id)
        )
    """)

    conn.execute("""
        CREATE NODE TABLE Purpose (
            purpose_id INT64,
            name       STRING,
            PRIMARY KEY (purpose_id)
        )
    """)

    # ------------------------------------------------------------------
    # DDL: relationship tables
    # ------------------------------------------------------------------
    for rel, src, dst in [
        ("OPERATED_BY",     "Satellite",    "Organization"),
        ("BUILT_BY",        "Satellite",    "Organization"),
        ("REGISTERED_IN",   "Satellite",    "Country"),
        ("OPERATOR_COUNTRY","Satellite",    "Country"),
        ("BASED_IN",        "Organization", "Country"),
        ("LAUNCHED_FROM",   "Satellite",    "LaunchSite"),
        ("USES_VEHICLE",    "Satellite",    "LaunchVehicle"),
        ("HAS_PURPOSE",     "Satellite",    "Purpose"),
    ]:
        conn.execute(f"CREATE REL TABLE {rel} (FROM {src} TO {dst})")

    # ------------------------------------------------------------------
    # Entity registries (in-Python dedup before INSERT)
    # ------------------------------------------------------------------
    org_map:     dict[str, int] = {}
    country_map: dict[str, int] = {}
    site_map:    dict[str, int] = {}
    vehicle_map: dict[str, int] = {}
    purpose_map: dict[str, int] = {}
    based_in_seen: set[tuple[int, int]] = set()   # prevent duplicate BASED_IN edges

    def _upsert_org(name: str) -> int | None:
        key = _norm_name(name)
        if not key:
            return None
        if key not in org_map:
            oid = len(org_map)
            org_map[key] = oid
            conn.execute(
                "CREATE (:Organization {org_id: $id, name: $name, name_lower: $nl})",
                {"id": oid, "name": key, "nl": key.lower()},
            )
        return org_map[key]

    def _upsert_country(name: str) -> int | None:
        key = _norm_name(name)
        if not key:
            return None
        if key not in country_map:
            cid = len(country_map)
            country_map[key] = cid
            conn.execute(
                "CREATE (:Country {country_id: $id, name: $name, name_lower: $nl})",
                {"id": cid, "name": key, "nl": key.lower()},
            )
        return country_map[key]

    def _upsert_site(name: str) -> int | None:
        key = _norm_name(name)
        if not key:
            return None
        if key not in site_map:
            sid = len(site_map)
            site_map[key] = sid
            conn.execute(
                "CREATE (:LaunchSite {site_id: $id, name: $name})",
                {"id": sid, "name": key},
            )
        return site_map[key]

    def _upsert_vehicle(name: str) -> int | None:
        key = _norm_name(name)
        if not key:
            return None
        if key not in vehicle_map:
            vid = len(vehicle_map)
            vehicle_map[key] = vid
            conn.execute(
                "CREATE (:LaunchVehicle {vehicle_id: $id, name: $name})",
                {"id": vid, "name": key},
            )
        return vehicle_map[key]

    def _upsert_purpose(name: str) -> int | None:
        key = _norm_name(name)
        if not key:
            return None
        if key not in purpose_map:
            pid = len(purpose_map)
            purpose_map[key] = pid
            conn.execute(
                "CREATE (:Purpose {purpose_id: $id, name: $name})",
                {"id": pid, "name": key},
            )
        return purpose_map[key]

    # ------------------------------------------------------------------
    # Insert satellite nodes + edges
    # ------------------------------------------------------------------
    print(f"Inserting {len(rows)} satellites...")

    for row in rows:
        sat_id = row["_sat_id"]

        name = _norm_name(row["Current Official Name of Satellite"])
        if not name:
            name = _norm_name(row["Name of Satellite, Alternate Names"])

        # --- Satellite node ---
        conn.execute(
            """CREATE (:Satellite {
                sat_id: $sid,
                norad: $norad,
                cospar: $cospar,
                name: $name,
                alt_names: $alt,
                orbit_class: $oc,
                orbit_type: $ot,
                perigee_km: $perigee,
                apogee_km: $apogee,
                inclination: $incl,
                period_min: $period,
                geo_lon: $geolon,
                launch_mass_kg: $lm,
                dry_mass_kg: $dm,
                power_w: $pw,
                launch_date: $ld,
                expected_lifetime_yrs: $el,
                users: $users,
                comments: $comments
            })""",
            {
                "sid":    sat_id,
                "norad":  row["NORAD Number"].strip(),
                "cospar": row["COSPAR Number"].strip(),
                "name":   name,
                "alt":    _norm_name(row["Name of Satellite, Alternate Names"]),
                "oc":     _norm_orbit_class(row["Class of Orbit"]),
                "ot":     row["Type of Orbit"].strip(),
                "perigee":  _parse_float(row["Perigee (km)"]),
                "apogee":   _parse_float(row["Apogee (km)"]),
                "incl":     _parse_float(row["Inclination (degrees)"]),
                "period":   _parse_float(row["Period (minutes)"]),
                "geolon":   _parse_float(row["Longitude of GEO (degrees)"]),
                "lm":       _parse_float(row["Launch Mass (kg.)"]),
                "dm":       _parse_float(row[" Dry Mass (kg.) "]),
                "pw":       _parse_float(row["Power (watts)"]),
                "ld":       _parse_date(row["Date of Launch"]),
                "el":       _parse_float(row["Expected Lifetime (yrs.)"]),
                "users":    row["Users"].strip(),
                "comments": row["Comments"].strip(),
            },
        )

        # --- OPERATED_BY ---
        op = _norm_name(row["Operator/Owner"])
        if op:
            oid = _upsert_org(op)
            conn.execute(
                "MATCH (s:Satellite {sat_id: $sid}), (o:Organization {org_id: $oid}) "
                "CREATE (s)-[:OPERATED_BY]->(o)",
                {"sid": sat_id, "oid": oid},
            )

        # --- BUILT_BY + BASED_IN ---
        # Contractor: keep as atomic string (do NOT split on "/"; "Space Systems/Loral" is one company)
        contractor = _norm_name(row["Contractor"])
        if contractor:
            coid = _upsert_org(contractor)
            conn.execute(
                "MATCH (s:Satellite {sat_id: $sid}), (o:Organization {org_id: $oid}) "
                "CREATE (s)-[:BUILT_BY]->(o)",
                {"sid": sat_id, "oid": coid},
            )
            # Country of Contractor: split on "/" — genuinely multi-country (e.g. "Sweden/UK/USA")
            for ctry_name in row["Country of Contractor"].split("/"):
                ctry_name = ctry_name.strip()
                if ctry_name:
                    ctry_id = _upsert_country(ctry_name)
                    if ctry_id is not None:
                        edge_key = (coid, ctry_id)
                        if edge_key not in based_in_seen:
                            based_in_seen.add(edge_key)
                            conn.execute(
                                "MATCH (o:Organization {org_id: $oid}), (c:Country {country_id: $cid}) "
                                "CREATE (o)-[:BASED_IN]->(c)",
                                {"oid": coid, "cid": ctry_id},
                            )

        # --- REGISTERED_IN (skip NR / Not Registered values) ---
        un_reg = row["Country/Org of UN Registry"].strip()
        if un_reg and not _is_nr(un_reg):
            reg_id = _upsert_country(un_reg)
            if reg_id is not None:
                conn.execute(
                    "MATCH (s:Satellite {sat_id: $sid}), (c:Country {country_id: $cid}) "
                    "CREATE (s)-[:REGISTERED_IN]->(c)",
                    {"sid": sat_id, "cid": reg_id},
                )

        # --- OPERATOR_COUNTRY ---
        op_ctry = row["Country of Operator/Owner"].strip()
        if op_ctry:
            op_ctry_id = _upsert_country(op_ctry)
            if op_ctry_id is not None:
                conn.execute(
                    "MATCH (s:Satellite {sat_id: $sid}), (c:Country {country_id: $cid}) "
                    "CREATE (s)-[:OPERATOR_COUNTRY]->(c)",
                    {"sid": sat_id, "cid": op_ctry_id},
                )

        # --- LAUNCHED_FROM ---
        site = _norm_name(row["Launch Site"])
        if site:
            site_id = _upsert_site(site)
            if site_id is not None:
                conn.execute(
                    "MATCH (s:Satellite {sat_id: $sid}), (ls:LaunchSite {site_id: $lsid}) "
                    "CREATE (s)-[:LAUNCHED_FROM]->(ls)",
                    {"sid": sat_id, "lsid": site_id},
                )

        # --- USES_VEHICLE ---
        vehicle = _norm_name(row["Launch Vehicle"])
        if vehicle:
            vid = _upsert_vehicle(vehicle)
            if vid is not None:
                conn.execute(
                    "MATCH (s:Satellite {sat_id: $sid}), (v:LaunchVehicle {vehicle_id: $vid}) "
                    "CREATE (s)-[:USES_VEHICLE]->(v)",
                    {"sid": sat_id, "vid": vid},
                )

        # --- HAS_PURPOSE (split composite "Communications/Earth Observation" on "/") ---
        for p in row["Purpose"].split("/"):
            p = p.strip()
            if p:
                pid = _upsert_purpose(p)
                if pid is not None:
                    conn.execute(
                        "MATCH (s:Satellite {sat_id: $sid}), (p:Purpose {purpose_id: $pid}) "
                        "CREATE (s)-[:HAS_PURPOSE]->(p)",
                        {"sid": sat_id, "pid": pid},
                    )

        if (sat_id + 1) % 500 == 0:
            print(f"  {sat_id + 1}/{len(rows)} processed...")

    conn.close()
    print(
        f"\nDone.\n"
        f"  Satellites : {len(rows)}\n"
        f"  Orgs       : {len(org_map)}\n"
        f"  Countries  : {len(country_map)}\n"
        f"  Sites      : {len(site_map)}\n"
        f"  Vehicles   : {len(vehicle_map)}\n"
        f"  Purposes   : {len(purpose_map)}\n"
        f"  DB path    : {DB_PATH}"
    )


if __name__ == "__main__":
    rows = load_csv()
    print(f"Loaded {len(rows)} unique satellites from {CSV_PATH.name}")
    build_graph(rows)
