/**
 * /api/satellites — parses satellite.csv (project root) and returns a JSON
 * array of CsvSatellite objects ready for the 3D globe.
 *
 * Orbital elements from the CSV (inclination, eccentricity, period, perigee,
 * apogee) are converted into approximate TLEs using the same buildTle() helper
 * used by the flagship catalog, so satellite.js SGP4 can propagate them.
 *
 * RAAN and mean anomaly are derived from the NORAD ID via a golden-angle
 * distribution so satellites spread evenly around their orbital planes rather
 * than stacking at a single point.
 */

import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { buildTle, type SatelliteOrbit } from "@/lib/satellites/catalog";

export const dynamic = "force-dynamic";

export type CsvSatellite = {
  id: string;
  name: string;
  country: string;
  agency: string;
  users: string;
  purpose: string;
  orbitClass: string;
  orbitType: string;
  inclinationDeg: number;
  perigeeKm: number;
  apogeeKm: number;
  eccentricity: number;
  periodMin: number;
  launchYear: number;
  noradId: number;
  color: string;
  tle: { line1: string; line2: string };
};

/* ── CSV helpers ─────────────────────────────────────────────────── */

/** Parse one CSV line, respecting double-quoted fields. */
function parseLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

/** Parse a numeric string that may contain commas (e.g. "35,778"). */
function parseNum(s: string): number {
  const n = parseFloat(s.replace(/,/g, ""));
  return isFinite(n) ? n : 0;
}

/* ── color map ───────────────────────────────────────────────────── */

const PURPOSE_COLOR: Record<string, string> = {
  "Earth Observation":      "#3d74ff",
  "Communications":         "#22c55e",
  "Navigation":             "#f97316",
  "Technology Development": "#a855f7",
  "Technology":             "#8b5cf6",
  "Earth Science":          "#06b6d4",
  "Space Science":          "#9333ea",
  "Meteorology":            "#f43f5e",
  "Surveillance":           "#ef4444",
  "Remote Sensing":         "#60a5fa",
};

function colorFor(purpose: string, users: string): string {
  if (users === "Military") return "#dc2626";
  return PURPOSE_COLOR[purpose] ?? "#64748b";
}

/* ── TLE builder ─────────────────────────────────────────────────── */

/** Golden-angle spread so satellites distribute along their orbital planes. */
function goldenSpread(noradId: number, scale: number) {
  return (noradId * 137.508 * scale) % 360;
}

function buildCsvTle(row: {
  noradId: number;
  launchYear: number;
  inclination: number;
  eccentricity: number;
  periodMin: number;
  perigeeKm: number;
  apogeeKm: number;
}): { line1: string; line2: string } {
  // Mean motion (rev/day) from period; fall back to GEO if period is zero.
  const period = row.periodMin > 0 ? row.periodMin : 1436.1;
  const meanMotion = 1440 / period;

  // Semi-major axis (km) from period via Kepler's 3rd law (µ = 398600 km³/s²).
  // Used to derive argument of perigee from perigee altitude (sanity check only).
  const orbit: SatelliteOrbit = {
    inclinationDeg: row.inclination,
    raanDeg:        goldenSpread(row.noradId, 1.0),
    eccentricity:   Math.max(0, Math.min(0.9999, row.eccentricity)),
    argPerigeeDeg:  goldenSpread(row.noradId, 0.618),
    meanAnomalyDeg: goldenSpread(row.noradId, 2.236),
    meanMotionRevPerDay: meanMotion,
  };

  return buildTle(row.noradId, row.launchYear, orbit);
}

/* ── main handler ────────────────────────────────────────────────── */

// Module-level cache so we only parse once per process lifetime.
let _cache: CsvSatellite[] | null = null;

function parseAll(): CsvSatellite[] {
  if (_cache) return _cache;

  const csvPath = path.join(process.cwd(), "satellite.csv");
  if (!fs.existsSync(csvPath)) return [];

  const text = fs.readFileSync(csvPath, "utf8");
  const lines = text.split("\n");
  const result: CsvSatellite[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const f = parseLine(line);
    if (f.length < 27) continue;

    const noradId = parseInt(f[26], 10);
    if (!noradId || noradId < 1) continue;

    const name    = f[1] || f[0] || "Unknown";
    const country = f[3] || f[2] || "Unknown";
    const agency  = f[4] || "Unknown";
    const users   = f[5] || "Unknown";
    const purpose = f[6] || "Unknown";
    const orbitClass = f[8] || "LEO";
    const orbitType  = f[9] || "";

    const inclination  = parseNum(f[14]);
    const eccentricity = parseNum(f[13]);
    const perigeeKm    = parseNum(f[11]);
    const apogeeKm     = parseNum(f[12]);
    const periodMin    = parseNum(f[15]);

    // Parse launch year from "YYYY/M/D" or "YYYY/MM/DD".
    const launchYear = parseInt(f[19]?.split("/")[0] ?? "2000", 10) || 2000;

    try {
      const tle = buildCsvTle({ noradId, launchYear, inclination, eccentricity, periodMin, perigeeKm, apogeeKm });
      result.push({
        id:   `csv-${noradId}`,
        name, country, agency, users, purpose,
        orbitClass, orbitType,
        inclinationDeg: inclination,
        perigeeKm, apogeeKm, eccentricity, periodMin,
        launchYear, noradId,
        color: colorFor(purpose, users),
        tle,
      });
    } catch {
      // Skip rows with bad orbital elements.
    }
  }

  _cache = result;
  return result;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orbitClass = url.searchParams.get("orbit") ?? "";
  const purpose    = url.searchParams.get("purpose") ?? "";
  const users      = url.searchParams.get("users") ?? "";
  const country    = url.searchParams.get("country")?.toLowerCase() ?? "";
  const limit      = Math.min(500, parseInt(url.searchParams.get("limit") ?? "500", 10));

  let data = parseAll();

  if (orbitClass) data = data.filter((s) => s.orbitClass === orbitClass);
  if (purpose)    data = data.filter((s) => s.purpose === purpose);
  if (users)      data = data.filter((s) => s.users === users);
  if (country)    data = data.filter((s) => s.country.toLowerCase().includes(country));

  // Evenly sample if over the rendering limit.
  if (data.length > limit) {
    const step = data.length / limit;
    data = Array.from({ length: limit }, (_, k) => data[Math.floor(k * step)]);
  }

  // Return only the fields the globe needs (keeps payload small).
  const slim = data.map(({ id, name, country: c, agency, users: u, purpose: p,
    orbitClass: oc, orbitType: ot, inclinationDeg, perigeeKm, apogeeKm,
    eccentricity, periodMin, launchYear, noradId, color, tle }) => ({
    id, name, country: c, agency, users: u, purpose: p,
    orbitClass: oc, orbitType: ot, inclinationDeg, perigeeKm, apogeeKm,
    eccentricity, periodMin, launchYear, noradId, color, tle,
  }));

  return NextResponse.json(slim);
}
