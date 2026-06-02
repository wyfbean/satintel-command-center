/**
 * Persistent article storage.
 *
 * Articles are upserted with INSERT OR REPLACE so a re-crawl of the same URL
 * updates content without creating duplicates. The primary key is a
 * content-stable id derived from the source adapter (url-based hash).
 *
 * Reads always serve from newest-first.
 */

import { getDb } from "@/lib/intel/db";
import type { RawIntelRecord } from "@/types/intel";

export type StoredArticle = RawIntelRecord & {
  titleZh: string;
  summary: string;
  whyItMatters: string;
  crawledAt: number;
  compositeScore: number;
};

type DbRow = {
  id: string;
  source_id: string;
  source_name: string;
  channel: string;
  title: string;
  title_zh: string;
  excerpt: string;
  body: string;
  url: string;
  summary: string;
  why_it_matters: string;
  published_at: string;
  crawled_at: number;
  tags: string;
  region: string;
  imagery_modes: string;
  composite_score: number;
  image: string;
};

function rowToArticle(r: DbRow): StoredArticle {
  return {
    id: r.id,
    sourceId: r.source_id,
    sourceName: r.source_name,
    channel: r.channel as StoredArticle["channel"],
    title: r.title,
    titleZh: r.title_zh || r.title,
    excerpt: r.excerpt,
    body: r.body,
    url: r.url,
    summary: r.summary,
    whyItMatters: r.why_it_matters,
    publishedAt: r.published_at,
    crawledAt: r.crawled_at,
    tags: r.tags ? r.tags.split(",").filter(Boolean) : [],
    region: r.region,
    imageryModes: (r.imagery_modes
      ? r.imagery_modes.split(",").filter(Boolean)
      : ["RGB"]) as Array<"RGB" | "SAR" | "MS">,
    compositeScore: r.composite_score,
    image: r.image || undefined,
  };
}

export type UpsertPayload = {
  record: RawIntelRecord;
  titleZh: string;
  summary: string;
  whyItMatters: string;
  compositeScore: number;
};

/** Insert or update a single article. Returns true if it was newly inserted. */
export function upsertArticle(p: UpsertPayload): boolean {
  const db = getDb();
  if (!db) return false;
  const existing = db
    .prepare("SELECT id FROM articles WHERE id = ?")
    .get(p.record.id) as { id: string } | undefined;

  db.prepare(`
    INSERT OR REPLACE INTO articles
      (id, source_id, source_name, channel, title, title_zh, excerpt, body, url,
       summary, why_it_matters, published_at, crawled_at, tags, region, imagery_modes, composite_score, image)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    p.record.id,
    p.record.sourceId,
    p.record.sourceName,
    p.record.channel,
    p.record.title,
    p.titleZh,
    p.record.excerpt,
    p.record.body,
    p.record.url,
    p.summary,
    p.whyItMatters,
    p.record.publishedAt,
    Date.now(),
    p.record.tags.join(","),
    p.record.region,
    p.record.imageryModes.join(","),
    p.compositeScore,
    p.record.image ?? "",
  );
  return !existing;
}

export type ListOptions = {
  limit?: number;
  sinceMs?: number;         // only articles crawled after this epoch ms
  excludeChannels?: string[];
};

/** Return articles sorted by composite_score DESC, newest crawl first as tiebreaker. */
export function listArticles(opts: ListOptions = {}): StoredArticle[] {
  const db = getDb();
  if (!db) return [];
  const limit = opts.limit ?? 60;
  const since = opts.sinceMs ?? 0;
  const excluded = opts.excludeChannels ?? [];

  let sql = "SELECT * FROM articles WHERE crawled_at >= ?";
  const params: unknown[] = [since];

  if (excluded.length) {
    sql += ` AND channel NOT IN (${excluded.map(() => "?").join(",")})`;
    params.push(...excluded);
  }

  sql += " ORDER BY composite_score DESC, crawled_at DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as DbRow[];
  return rows.map(rowToArticle);
}

/** Count of articles newer than the given epoch ms. */
export function countRecentArticles(sinceMs: number): number {
  const db = getDb();
  if (!db) return 0;
  const r = db
    .prepare("SELECT COUNT(*) as n FROM articles WHERE crawled_at >= ?")
    .get(sinceMs) as { n: number };
  return r.n;
}

/** Delete articles older than `keepDays` to prevent unbounded growth. */
export function pruneOldArticles(keepDays = 14): number {
  const db = getDb();
  if (!db) return 0;
  const cutoff = Date.now() - keepDays * 24 * 3600 * 1000;
  const result = db
    .prepare("DELETE FROM articles WHERE crawled_at < ? AND channel != 'mock'")
    .run(cutoff);
  return result.changes;
}

/** Log an ingestion run start; return its row id. */
export function logRunStart(): number {
  const db = getDb();
  if (!db) return -1;
  const r = db
    .prepare("INSERT INTO ingestion_runs (started_at, status) VALUES (?, 'running')")
    .run(Date.now());
  return Number(r.lastInsertRowid);
}

/** Update an ingestion run on completion. */
export function logRunEnd(runId: number, itemsIn: number, itemsNew: number, error?: string): void {
  const db = getDb();
  if (!db || runId < 0) return;
  db.prepare(`
    UPDATE ingestion_runs
    SET ended_at = ?, status = ?, items_in = ?, items_new = ?, error = ?
    WHERE id = ?
  `).run(Date.now(), error ? "error" : "ok", itemsIn, itemsNew, error ?? null, runId);
}

/** Return the last N run summaries (for the status endpoint). */
export function listRecentRuns(n = 5) {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare("SELECT * FROM ingestion_runs ORDER BY id DESC LIMIT ?")
    .all(n) as Array<{
      id: number;
      started_at: number;
      ended_at: number | null;
      status: string;
      items_in: number;
      items_new: number;
      error: string | null;
    }>;
}
