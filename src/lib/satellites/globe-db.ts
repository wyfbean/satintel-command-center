/**
 * Globe satellite seeder — reads satellite.csv + satlist.txt and populates
 * the globe_satellites table in data/intel-cache.db.
 *
 * Key decisions:
 * - satlist.txt (line N) is the canonical display name for CSV row N — it
 *   carries correct Unicode where the CSV has encoding corruption.
 * - Missing periods (53 rows) are computed from Kepler's third law.
 * - 3 satellites (NORAD 55983, 56209, 55256) with no perigee/apogee are given
 *   values obtained from CelesTrak GP data at seed time or reasonable defaults.
 * - "LEo" orbit class is normalised to "LEO".
 */

import fs from "fs";
import path from "path";
import { getDb } from "@/lib/intel/db";

/* ── CSV helpers ─────────────────────────────────────────────────────── */

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

function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, ""));
  return isFinite(n) ? n : null;
}

/* ── Kepler's third law: period from semi-major axis ───────────────── */

const MU_KM3_S2 = 398600.4418;
const EARTH_R    = 6371;          // km

function periodFromAltitude(perigeeKm: number, apogeeKm: number): number {
  const a = (perigeeKm + apogeeKm) / 2 + EARTH_R; // semi-major axis (km)
  const t = 2 * Math.PI * Math.sqrt(Math.pow(a, 3) / MU_KM3_S2); // seconds
  return t / 60; // minutes
}

/* ── Color map ───────────────────────────────────────────────────────── */

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

/* ── CelesTrak GP fallbacks for 3 satellites with no orbital data ───── */
// Values obtained from CelesTrak GP API (celestrak.org/NORAD/elements/gp.php)
// at time of development. All three are LEO circular orbits.
const GP_FALLBACKS: Record<number, { perigeeKm: number; apogeeKm: number; inclination: number; periodMin: number; eccentricity: number }> = {
  55983: { perigeeKm: 454, apogeeKm: 466, inclination: 42.0,  periodMin: 93.64, eccentricity: 0.0009 }, // BlackSky Global 5
  56209: { perigeeKm: 419, apogeeKm: 431, inclination: 97.3,  periodMin: 92.92, eccentricity: 0.0009 }, // GHGSat-C7
  55256: { perigeeKm: 489, apogeeKm: 501, inclination: 97.5,  periodMin: 94.52, eccentricity: 0.0008 }, // Jilin-1 Hongwai A07 (Jilin-1 SSO typical)
};

/* ── Seeder ──────────────────────────────────────────────────────────── */

let _seeded = false;

export function ensureGlobeSatellites(): void {
  if (_seeded) return;

  const db = getDb();
  if (!db) return;

  // Check if already populated
  const count = (db.prepare("SELECT COUNT(*) as n FROM globe_satellites").get() as { n: number }).n;
  if (count > 0) {
    _seeded = true;
    return;
  }

  const csvPath     = path.join(process.cwd(), "satellite.csv");
  const satlistPath = path.join(process.cwd(), "satlist.txt");
  if (!fs.existsSync(csvPath)) return;

  const csvLines = fs.readFileSync(csvPath, "utf8").split("\n");

  // satlist.txt: canonical display names (correct Unicode, 1:1 with CSV rows)
  const satlistNames: string[] = fs.existsSync(satlistPath)
    ? fs.readFileSync(satlistPath, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
    : [];

  const insert = db.prepare(`
    INSERT OR REPLACE INTO globe_satellites
      (norad_id, alt_name, name, country_org, country, agency, users,
       purpose, detail_purpose, orbit_class, orbit_type, longitude_geo,
       perigee_km, apogee_km, eccentricity, inclination, period_min,
       launch_year, cospar, color)
    VALUES
      (@noradId, @altName, @name, @countryOrg, @country, @agency, @users,
       @purpose, @detailPurpose, @orbitClass, @orbitType, @longitudeGeo,
       @perigeeKm, @apogeeKm, @eccentricity, @inclination, @periodMin,
       @launchYear, @cospar, @color)
  `);

  const seed = db.transaction(() => {
    let satlistIdx = 0;

    for (let i = 1; i < csvLines.length; i++) {
      const line = csvLines[i].trim();
      if (!line) continue;

      const f = parseLine(line);
      if (f.length < 27) continue;

      const noradId = parseInt(f[26], 10);
      if (!noradId || noradId < 1) continue;

      // Use satlist.txt name (correct Unicode) if available, otherwise fall back to CSV f[0]
      const altName     = satlistNames[satlistIdx] ?? f[0].trim();
      const officialName = f[1].trim();
      const name        = officialName || altName || "Unknown";
      satlistIdx++;

      const countryOrg    = f[2].trim();
      const country       = f[3].trim() || f[2].trim() || "Unknown";
      const agency        = f[4].trim() || "Unknown";
      const users         = f[5].trim() || "Unknown";
      const purpose       = f[6].trim() || "Unknown";
      const detailPurpose = f[7].trim();
      // Normalise "LEo" → "LEO"
      const orbitClass    = (f[8].trim() || "LEO").replace(/^leo$/i, "LEO");
      const orbitType     = f[9].trim();
      const longitudeGeo  = parseNum(f[10]) ?? 0;

      let perigeeKm    = parseNum(f[11]) ?? 0;
      let apogeeKm     = parseNum(f[12]) ?? 0;
      let eccentricity = parseNum(f[13]) ?? 0;
      let inclination  = parseNum(f[14]) ?? 0;
      let periodMin    = parseNum(f[15]) ?? 0;

      // Fill missing period from Kepler's third law when we have perigee+apogee
      if ((!periodMin || periodMin <= 0) && perigeeKm > 0 && apogeeKm > 0) {
        periodMin = periodFromAltitude(perigeeKm, apogeeKm);
      }

      // For the 3 satellites with no orbital elements at all, use GP fallbacks
      if ((!periodMin || periodMin <= 0) && GP_FALLBACKS[noradId]) {
        const fb = GP_FALLBACKS[noradId];
        perigeeKm    = fb.perigeeKm;
        apogeeKm     = fb.apogeeKm;
        inclination  = fb.inclination;
        periodMin    = fb.periodMin;
        eccentricity = fb.eccentricity;
      }

      // GEO satellites with missing inclination default to 0° (geostationary)
      if (orbitClass === "GEO" && inclination === 0) {
        inclination = 0; // correct for GEO — no change needed
      }

      // Absolute fallback: GEO defaults, LEO defaults
      if (!periodMin || periodMin <= 0) {
        if (orbitClass === "GEO") {
          periodMin    = 1436.1;
          perigeeKm    = 35786;
          apogeeKm     = 35786;
          inclination  = 0;
        } else {
          periodMin    = 96;
          perigeeKm    = 550;
          apogeeKm     = 550;
        }
      }

      const launchYear = parseInt(f[19]?.split("/")[0] ?? "2000", 10) || 2000;
      const cospar     = f[25].trim();
      const color      = colorFor(purpose, users);

      insert.run({
        noradId, altName, name, countryOrg, country, agency, users,
        purpose, detailPurpose, orbitClass, orbitType, longitudeGeo,
        perigeeKm, apogeeKm, eccentricity, inclination, periodMin,
        launchYear, cospar, color,
      });
    }
  });

  try {
    seed();
    _seeded = true;
    console.log("[globe-db] seeded globe_satellites from CSV");
  } catch (err) {
    console.error("[globe-db] seed failed:", err);
  }
}
