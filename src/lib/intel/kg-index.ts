/**
 * Lightweight in-memory satellite KG index (v1.0 recommendation expansion).
 *
 * Loads satellite-KG.csv once on first call and caches it in globalThis.
 * No Kuzu / no Python process needed — just CSV + a few Maps.
 *
 * Purpose: given the entities extracted from a clicked article
 * (e.g. "Sentinel-2", "ESA", "Copernicus"), find related satellites
 * from the same operator / country / purpose cluster, then add those
 * names to the user's preference vector so articles mentioning them
 * get a subtle boost.
 */

import fs from "fs";
import path from "path";

/* ── record type ─────────────────────────────────────────────────── */

type SatRecord = {
  name:     string;   // normalised official name (lowercase)
  operator: string;
  country:  string;
  purpose:  string;
};

type KgIndex = {
  byName:     Map<string, SatRecord>;          // name  → record
  byOperator: Map<string, Set<string>>;        // operator → satellite names
  byCountry:  Map<string, Set<string>>;        // country  → satellite names
  byPurpose:  Map<string, Set<string>>;        // purpose  → satellite names
};

/* ── CSV helpers (same approach as /api/satellites/route.ts) ──────── */

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
      fields.push(field.trim()); field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function norm(s: string) { return s.toLowerCase().trim(); }

function addToIndex<K>(map: Map<K, Set<string>>, key: K, value: string) {
  if (!key || !value) return;
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

/* ── loader ──────────────────────────────────────────────────────── */

const G = globalThis as typeof globalThis & { __satKgIndex?: KgIndex };

export function getKgIndex(): KgIndex {
  if (G.__satKgIndex) return G.__satKgIndex;

  const csvPath = path.join(process.cwd(), "satellite-KG.csv");
  const index: KgIndex = {
    byName:     new Map(),
    byOperator: new Map(),
    byCountry:  new Map(),
    byPurpose:  new Map(),
  };

  if (!fs.existsSync(csvPath)) {
    G.__satKgIndex = index;
    return index;
  }

  const lines = fs.readFileSync(csvPath, "utf8").split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const f = parseLine(line);
    if (f.length < 8) continue;

    // Columns (0-indexed after proper CSV parse):
    //  1 = Current Official Name
    //  3 = Country of Operator
    //  4 = Operator/Owner
    //  6 = Purpose
    const name     = norm(f[1] || f[0]);
    const country  = norm(f[3]);
    const operator = norm(f[4]);
    const purpose  = norm(f[6]);

    if (!name) continue;
    const rec: SatRecord = { name, operator, country, purpose };
    index.byName.set(name, rec);
    addToIndex(index.byOperator, operator, name);
    addToIndex(index.byCountry,  country,  name);
    addToIndex(index.byPurpose,  purpose,  name);
  }

  G.__satKgIndex = index;
  console.log(`[kg-index] loaded ${index.byName.size} satellites`);
  return index;
}

/* ── public: entity → related satellite names ────────────────────── */

const MAX_RELATED = 8;   // cap expansion to avoid bloating user_interests

/**
 * Given a list of entity strings extracted from a clicked article
 * (satellite names, agency names, mission names, country names, etc.),
 * return up to MAX_RELATED normalised satellite names that are related
 * via the same operator / country / purpose cluster.
 *
 * The caller adds these as "satellite" feature type in user_interests
 * with a fractional weight (0.5) so they gently boost articles that
 * mention any of the returned satellites.
 */
export function findRelated(entities: string[]): string[] {
  if (!entities.length) return [];
  const idx = getKgIndex();
  const related = new Set<string>();

  for (const raw of entities) {
    const e = norm(raw);

    // Direct name hit → expand to operator/country cluster
    const rec = idx.byName.get(e);
    if (rec) {
      // Add siblings from same operator (cap 4)
      (idx.byOperator.get(rec.operator) ?? new Set()).forEach((n) => {
        if (n !== e && related.size < MAX_RELATED) related.add(n);
      });
      // Add siblings from same country (cap — already bounded by MAX_RELATED)
      (idx.byCountry.get(rec.country) ?? new Set()).forEach((n) => {
        if (n !== e && related.size < MAX_RELATED) related.add(n);
      });
    }

    // Operator / country / purpose lookup (entity may be "ESA", "China", etc.)
    (idx.byOperator.get(e) ?? new Set()).forEach((n) => {
      if (related.size < MAX_RELATED) related.add(n);
    });
    (idx.byCountry.get(e) ?? new Set()).forEach((n) => {
      if (related.size < MAX_RELATED) related.add(n);
    });
    (idx.byPurpose.get(e) ?? new Set()).forEach((n) => {
      if (related.size < MAX_RELATED) related.add(n);
    });

    if (related.size >= MAX_RELATED) break;
  }

  return Array.from(related).slice(0, MAX_RELATED);
}
