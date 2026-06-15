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
        composite_score REAL NOT NULL DEFAULT 0,
        image           TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS articles_crawled ON articles(crawled_at DESC);
      CREATE INDEX IF NOT EXISTS articles_channel  ON articles(channel);
    `);

    // Migrate pre-existing DBs that lack the image column (idempotent).
    const cols = (db.prepare("PRAGMA table_info(articles)").all() as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes("image")) {
      db.exec("ALTER TABLE articles ADD COLUMN image TEXT NOT NULL DEFAULT ''");
    }
    // `enriched` flags rows whose title/summary have been LLM-processed, so the
    // async enrichment pass (ingestion-worker) can skip them. Existing rows that
    // already carry a Chinese title are marked enriched so they aren't reprocessed;
    // rows whose translation never landed (title_zh empty or == title) stay 0 to retry.
    if (!cols.includes("enriched")) {
      db.exec("ALTER TABLE articles ADD COLUMN enriched INTEGER NOT NULL DEFAULT 0");
      db.exec("UPDATE articles SET enriched = 1 WHERE channel = 'mock' OR (title_zh != '' AND title_zh != title)");
    }

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

    // ── User click events (raw log, owned by reranker.ts) ───────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT    NOT NULL,
        article_id  TEXT    NOT NULL,
        event_type  TEXT    NOT NULL DEFAULT 'click',
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS user_events_session
        ON user_events(session_id, created_at DESC);
    `);

    // ── Aggregated user preferences (materialised from user_events) ───────
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_interests (
        session_id    TEXT NOT NULL,
        feature_type  TEXT NOT NULL,
        feature_value TEXT NOT NULL,
        weight        REAL NOT NULL DEFAULT 1.0,
        last_updated  INTEGER NOT NULL,
        PRIMARY KEY (session_id, feature_type, feature_value)
      );
    `);

    // ── Globe satellite catalog (seeded from satellite.csv) ──────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS globe_satellites (
        norad_id     INTEGER PRIMARY KEY,
        alt_name     TEXT NOT NULL DEFAULT '',
        name         TEXT NOT NULL DEFAULT '',
        country_org  TEXT NOT NULL DEFAULT '',
        country      TEXT NOT NULL DEFAULT '',
        agency       TEXT NOT NULL DEFAULT '',
        users        TEXT NOT NULL DEFAULT '',
        purpose      TEXT NOT NULL DEFAULT '',
        detail_purpose TEXT NOT NULL DEFAULT '',
        orbit_class  TEXT NOT NULL DEFAULT 'LEO',
        orbit_type   TEXT NOT NULL DEFAULT '',
        longitude_geo REAL NOT NULL DEFAULT 0,
        perigee_km   REAL NOT NULL DEFAULT 0,
        apogee_km    REAL NOT NULL DEFAULT 0,
        eccentricity REAL NOT NULL DEFAULT 0,
        inclination  REAL NOT NULL DEFAULT 0,
        period_min   REAL NOT NULL DEFAULT 0,
        launch_year  INTEGER NOT NULL DEFAULT 2000,
        cospar       TEXT NOT NULL DEFAULT '',
        color        TEXT NOT NULL DEFAULT '#64748b'
      );
      CREATE INDEX IF NOT EXISTS globe_sat_orbit   ON globe_satellites(orbit_class);
      CREATE INDEX IF NOT EXISTS globe_sat_purpose ON globe_satellites(purpose);
      CREATE INDEX IF NOT EXISTS globe_sat_users   ON globe_satellites(users);
      CREATE INDEX IF NOT EXISTS globe_sat_country ON globe_satellites(country);
    `);

    // ── Authenticated users (OAuth + email/password) ─────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL DEFAULT '',
        email         TEXT UNIQUE,
        password_hash TEXT,
        image         TEXT NOT NULL DEFAULT '',
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id                   TEXT PRIMARY KEY,
        user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider             TEXT NOT NULL,
        provider_account_id  TEXT NOT NULL,
        UNIQUE(provider, provider_account_id)
      );
      CREATE INDEX IF NOT EXISTS accounts_user_id ON accounts(user_id);
    `);

    G.__satintelDb = db;
    return db;
  } catch (err) {
    console.error("[db] failed to open SQLite:", err);
    G.__satintelDbFailed = true;
    return null;
  }
}
