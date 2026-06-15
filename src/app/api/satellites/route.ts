/**
 * /api/satellites — returns all satellites from the globe_satellites SQLite
 * table (seeded from satellite.csv + satlist.txt on first call).
 *
 * Supports optional server-side filtering via query params:
 *   ?orbit=LEO|MEO|GEO|Elliptical
 *   ?purpose=Earth+Observation|Communications|...
 *   ?users=Commercial|Government|Military|Civil
 *   ?country=<partial match, case-insensitive>
 *
 * No hard cap on returned count — the full 7 000+ catalog is served.
 * TLEs are built server-side from orbital elements so the client can run
 * SGP4 for orbit-ring rendering of the selected satellite.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/intel/db";
import { ensureGlobeSatellites } from "@/lib/satellites/globe-db";
import { buildTle, type SatelliteOrbit } from "@/lib/satellites/catalog";

export const dynamic = "force-dynamic";

export type CsvSatellite = {
  id:             string;
  name:           string;
  country:        string;
  agency:         string;
  users:          string;
  purpose:        string;
  orbitClass:     string;
  orbitType:      string;
  inclinationDeg: number;
  perigeeKm:      number;
  apogeeKm:       number;
  eccentricity:   number;
  periodMin:      number;
  launchYear:     number;
  noradId:        number;
  color:          string;
  tle:            { line1: string; line2: string };
};

/* ── Golden-angle RAAN / mean anomaly ──────────────────────────────── */

function goldenSpread(noradId: number, scale: number): number {
  return (noradId * 137.508 * scale) % 360;
}

function buildCsvTle(row: {
  noradId:     number;
  launchYear:  number;
  inclination: number;
  eccentricity:number;
  periodMin:   number;
  perigeeKm:   number;
  apogeeKm:    number;
}): { line1: string; line2: string } {
  const period     = row.periodMin > 0 ? row.periodMin : 1436.1;
  const meanMotion = 1440 / period;

  const orbit: SatelliteOrbit = {
    inclinationDeg:      row.inclination,
    raanDeg:             goldenSpread(row.noradId, 1.0),
    eccentricity:        Math.max(0, Math.min(0.9999, row.eccentricity)),
    argPerigeeDeg:       goldenSpread(row.noradId, 0.618),
    meanAnomalyDeg:      goldenSpread(row.noradId, 2.236),
    meanMotionRevPerDay: meanMotion,
  };

  return buildTle(row.noradId, row.launchYear, orbit);
}

/* ── Main handler ───────────────────────────────────────────────────── */

export async function GET(request: Request) {
  ensureGlobeSatellites();

  const db = getDb();
  if (!db) return NextResponse.json([]);

  const url     = new URL(request.url);
  const orbit   = url.searchParams.get("orbit") ?? "";
  const purpose = url.searchParams.get("purpose") ?? "";
  const users   = url.searchParams.get("users") ?? "";
  const country = url.searchParams.get("country")?.toLowerCase() ?? "";

  // Build WHERE clause
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (orbit)   { conditions.push("orbit_class = ?");                params.push(orbit); }
  if (purpose) { conditions.push("purpose = ?");                    params.push(purpose); }
  if (users)   { conditions.push("users = ?");                      params.push(users); }
  if (country) { conditions.push("LOWER(country) LIKE ?");          params.push(`%${country}%`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  type Row = {
    norad_id:     number;
    alt_name:     string;
    name:         string;
    country:      string;
    agency:       string;
    users:        string;
    purpose:      string;
    orbit_class:  string;
    orbit_type:   string;
    inclination:  number;
    perigee_km:   number;
    apogee_km:    number;
    eccentricity: number;
    period_min:   number;
    launch_year:  number;
    color:        string;
  };

  const rows = db.prepare(
    `SELECT norad_id, alt_name, name, country, agency, users, purpose,
            orbit_class, orbit_type, inclination, perigee_km, apogee_km,
            eccentricity, period_min, launch_year, color
     FROM globe_satellites ${where}`
  ).all(...params) as Row[];

  const result: CsvSatellite[] = [];
  for (const r of rows) {
    try {
      const tle = buildCsvTle({
        noradId:      r.norad_id,
        launchYear:   r.launch_year,
        inclination:  r.inclination,
        eccentricity: r.eccentricity,
        periodMin:    r.period_min,
        perigeeKm:    r.perigee_km,
        apogeeKm:     r.apogee_km,
      });
      result.push({
        id:             `csv-${r.norad_id}`,
        name:           r.name || r.alt_name || "Unknown",
        country:        r.country,
        agency:         r.agency,
        users:          r.users,
        purpose:        r.purpose,
        orbitClass:     r.orbit_class,
        orbitType:      r.orbit_type,
        inclinationDeg: r.inclination,
        perigeeKm:      r.perigee_km,
        apogeeKm:       r.apogee_km,
        eccentricity:   r.eccentricity,
        periodMin:      r.period_min,
        launchYear:     r.launch_year,
        noradId:        r.norad_id,
        color:          r.color,
        tle,
      });
    } catch {
      // Skip rows with unrecoverable orbital elements.
    }
  }

  return NextResponse.json(result);
}
