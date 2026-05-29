import * as satellite from "satellite.js";
import { satelliteCatalog } from "../src/lib/satellites/catalog.ts";

const now = new Date();
const gmst = satellite.gstime(now);
let ok = 0;
let bad = 0;

for (const sat of satelliteCatalog) {
  const satrec = satellite.twoline2satrec(sat.tle.line1, sat.tle.line2);
  const pv = satellite.propagate(satrec, now);
  const eci = pv && typeof pv === "object" ? (pv as { position?: unknown }).position : undefined;
  if (!eci || typeof eci !== "object") {
    console.log(`BAD  ${sat.name}: no position (satrec.error=${satrec.error})`);
    bad += 1;
    continue;
  }
  const geo = satellite.eciToGeodetic(eci as satellite.EciVec3<number>, gmst);
  const lat = satellite.degreesLat(geo.latitude);
  const lon = satellite.degreesLong(geo.longitude);
  const altKm = geo.height;
  const valid = [lat, lon, altKm].every((n) => Number.isFinite(n)) && altKm > 100 && altKm < 50000;
  if (valid) {
    ok += 1;
    console.log(`OK   ${sat.name.padEnd(28)} lat=${lat.toFixed(1)} lon=${lon.toFixed(1)} alt=${Math.round(altKm)}km`);
  } else {
    bad += 1;
    console.log(`BAD  ${sat.name}: lat=${lat} lon=${lon} alt=${altKm}`);
  }
}

console.log(`\n${ok}/${satelliteCatalog.length} valid, ${bad} bad`);
process.exit(bad === 0 ? 0 : 1);
