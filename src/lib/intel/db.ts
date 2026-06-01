/**
 * Shared SQLite singleton for all intel persistence modules.
 *
 * Opens data/intel-cache.db once, applies WAL mode, and creates every table
 * needed by cache.ts, rss-store.ts, and article-store.ts.  All callers import
 * `getDb()` from here instead of opening their own connection.
 *
 * Uses a globalThis key so that Next.js HMR module re-evaluation doesn't
 * create duplicate connections during development.
 */

import fs from "fs";
import path from "path";

type Db = import("better-sqlite3").Database;

const G = globalThis as typeof globalThis & { __satintelDb?: Db; __satintelDbFailed?: boolean };

export function getDb(): Db | null {
  if (G.__satintelDbFailed) return null;
  if (G.__satintelDb) return G.__satintelDb;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const dir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const db = new Database(path.join(dir, "intel-cache.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

    // ── LLM response cache (owned by cache.ts) ──────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_cache (
        key       TEXT PRIMARY KEY,
        value     TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        ttl_s     INTEGER NOT NULL
      );
    `);

    // ── User-managed RSS subscriptions (owned by rss-store.ts) ──────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_rss_feeds (
        id       TEXT PRIMARY KEY,
        url      TEXT NOT NULL,
        name     TEXT NOT NULL,
        tags     TEXT NOT NULL DEFAULT '',
        added_at INTEGER NOT NULL
      );
    `);

    // ── Persisted articles (owned by article-store.ts) ──────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS articles (
        id              TEXT PRIMARY KEY,
        source_id       TEXT NOT NULL,
        source_name     TEXT NOT NULL,
        channel         TEXT NOT NULL,
        title           TEXT NOT NULL,
        title_zh        TEXT NOT NULL DEFAULT '',
        excerpt         TEXT NOT NULL DEFAULT '',
        body            TEXT NOT NULL DEFAULT '',
        url             TEXT NOT NULL,
        summary         TEXT NOT NULL DEFAULT '',
        why_it_matters  TEXT NOT NULL DEFAULT '',
        published_at    TEXT NOT NULL,
        crawled_at      INTEGER NOT NULL,
        tags            TEXT NOT NULL DEFAULT '',
        region          TEXT NOT NULL DEFAULT '',
        imagery_modes   TEXT NOT NULL DEFAULT '',
        composite_score REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS articles_crawled ON articles(crawled_at DESC);
      CREATE INDEX IF NOT EXISTS articles_channel  ON articles(channel);
    `);

    // ── Ingestion run log ────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS ingestion_runs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER,
        status     TEXT NOT NULL DEFAULT 'running',
        items_in   INTEGER NOT NULL DEFAULT 0,
        items_new  INTEGER NOT NULL DEFAULT 0,
        error      TEXT
      );
    `);

    G.__satintelDb = db;
    return db;
  } catch (err) {
    console.error("[db] failed to open SQLite:", err);
    G.__satintelDbFailed = true;
    return null;
  }
}
