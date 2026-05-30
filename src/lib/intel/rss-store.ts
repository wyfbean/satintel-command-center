/**
 * User-managed RSS subscriptions, stored in the same SQLite DB as the LLM cache
 * (data/intel-cache.db, git-ignored). Falls back gracefully when the DB is unavailable.
 *
 * Schema: user_rss_feeds (id TEXT PK, url TEXT, name TEXT, tags TEXT, added_at INTEGER)
 */

import fs from "fs";
import path from "path";

export type UserFeed = {
  id: string;
  url: string;
  name: string;
  tags: string[];   // comma-separated in DB
  addedAt: number;  // unix ms
};

let _db: import("better-sqlite3").Database | null = null;
let _failed = false;

function getDb() {
  if (_failed) return null;
  if (_db) return _db;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const dir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const db = new Database(path.join(dir, "intel-cache.db"));
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_rss_feeds (
        id       TEXT PRIMARY KEY,
        url      TEXT NOT NULL,
        name     TEXT NOT NULL,
        tags     TEXT NOT NULL DEFAULT '',
        added_at INTEGER NOT NULL
      );
    `);
    _db = db;
    return db;
  } catch {
    _failed = true;
    return null;
  }
}

export function listFeeds(): UserFeed[] {
  const db = getDb();
  if (!db) return [];
  const rows = db.prepare("SELECT * FROM user_rss_feeds ORDER BY added_at DESC").all() as Array<{
    id: string; url: string; name: string; tags: string; added_at: number;
  }>;
  return rows.map((r) => ({ ...r, tags: r.tags ? r.tags.split(",").map((t) => t.trim()).filter(Boolean) : [], addedAt: r.added_at }));
}

export function addFeed(feed: Omit<UserFeed, "addedAt">): UserFeed {
  const db = getDb();
  const record = { ...feed, addedAt: Date.now() };
  if (db) {
    db.prepare("INSERT OR REPLACE INTO user_rss_feeds (id, url, name, tags, added_at) VALUES (?, ?, ?, ?, ?)")
      .run(record.id, record.url, record.name, record.tags.join(","), record.addedAt);
  }
  return record;
}

export function removeFeed(id: string): void {
  const db = getDb();
  if (db) db.prepare("DELETE FROM user_rss_feeds WHERE id = ?").run(id);
}

export function updateFeed(id: string, patch: Partial<Pick<UserFeed, "url" | "name" | "tags">>): UserFeed | null {
  const db = getDb();
  if (!db) return null;
  const existing = db.prepare("SELECT * FROM user_rss_feeds WHERE id = ?").get(id) as
    { id: string; url: string; name: string; tags: string; added_at: number } | undefined;
  if (!existing) return null;
  const updated = {
    url: patch.url ?? existing.url,
    name: patch.name ?? existing.name,
    tags: patch.tags?.join(",") ?? existing.tags,
  };
  db.prepare("UPDATE user_rss_feeds SET url=?, name=?, tags=? WHERE id=?")
    .run(updated.url, updated.name, updated.tags, id);
  return { id, ...updated, tags: updated.tags ? updated.tags.split(",").filter(Boolean) : [], addedAt: existing.added_at };
}
