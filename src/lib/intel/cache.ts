/**
 * SQLite-backed LLM response cache.
 *
 * Every AI call (enrichItemSummary, generateBriefing) is keyed by a SHA-256
 * hash of the prompt inputs and cached with a TTL:
 *   - item summaries  → 7 days  (content rarely changes)
 *   - briefings       → 6 hours (want freshness but not per-request)
 *   - chat answers    → NOT cached (conversational, highly contextual)
 *
 * Cache DB lives at data/intel-cache.db (git-ignored).
 * Falls back gracefully if SQLite is unavailable.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

// Lazy-loaded so the module is safe to import even when the DB file isn't writable.
let _db: import("better-sqlite3").Database | null = null;
let _dbFailed = false;

function getDb() {
  if (_dbFailed) return null;
  if (_db) return _db;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const dir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const db = new Database(path.join(dir, "intel-cache.db"));
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_cache (
        key       TEXT PRIMARY KEY,
        value     TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        ttl_s     INTEGER NOT NULL
      );
    `);
    _db = db;
    return db;
  } catch {
    _dbFailed = true;
    return null;
  }
}

function hashKey(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 40);
}

export function cacheGet<T>(key: string): T | null {
  const db = getDb();
  if (!db) return null;
  try {
    const row = db
      .prepare("SELECT value, cached_at, ttl_s FROM llm_cache WHERE key = ?")
      .get(key) as { value: string; cached_at: number; ttl_s: number } | undefined;
    if (!row) return null;
    const ageS = (Date.now() - row.cached_at) / 1000;
    if (ageS > row.ttl_s) {
      db.prepare("DELETE FROM llm_cache WHERE key = ?").run(key);
      return null;
    }
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: unknown, ttlSeconds: number): void {
  const db = getDb();
  if (!db) return;
  try {
    db.prepare(
      "INSERT OR REPLACE INTO llm_cache (key, value, cached_at, ttl_s) VALUES (?, ?, ?, ?)",
    ).run(key, JSON.stringify(value), Date.now(), ttlSeconds);
  } catch {
    // ignore write failures
  }
}

/** Cache TTLs in seconds */
export const TTL = {
  ITEM_SUMMARY: 7 * 24 * 3600,  // 7 days — article content doesn't change
  BRIEFING:     6 * 3600,        // 6 hours — want periodic freshness
};

/** Stable cache key for a single item enrichment */
export function itemSummaryKey(title: string, url: string, bodyPreview: string): string {
  return hashKey(`summary:${title}:${url}:${bodyPreview.slice(0, 160)}`);
}

/** Stable cache key for a briefing over a set of items */
export function briefingKey(items: Array<{ title: string; compositeScore: number }>): string {
  const fingerprint = items
    .slice(0, 6)
    .map((i) => `${i.title}|${i.compositeScore}`)
    .join("||");
  return hashKey(`briefing:${fingerprint}`);
}

/** Evict expired rows (call occasionally to keep DB small; safe to skip) */
export function cacheEvictExpired(): void {
  const db = getDb();
  if (!db) return;
  try {
    db.prepare("DELETE FROM llm_cache WHERE (? - cached_at) / 1000 > ttl_s").run(Date.now());
  } catch {
    // ignore
  }
}
