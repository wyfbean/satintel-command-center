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
  enriched: number;
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
  enriched: number;
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
    enriched: r.enriched ?? 0,
  };
}

export type UpsertPayload = {
  record: RawIntelRecord;
  titleZh: string;
  summary: string;
  whyItMatters: string;
  compositeScore: number;
};

/**
 * Insert or update a single article. Returns true if it was newly inserted.
 *
 * LLM enrichment (title_zh / summary / why_it_matters / enriched) is *preserved*
 * across an unchanged re-crawl so the async enrichment pass doesn't get undone
 * and identical articles aren't re-sent to the LLM. The volatile composite_score
 * is always refreshed (freshness decays with time), and a changed body resets
 * enrichment back to 0 so the new content is re-processed.
 */
export function upsertArticle(p: UpsertPayload): boolean {
  const db = getDb();
  if (!db) return false;
  const existing = db
    .prepare("SELECT body, title_zh, summary, why_it_matters, enriched FROM articles WHERE id = ?")
    .get(p.record.id) as
    | { body: string; title_zh: string; summary: string; why_it_matters: string; enriched: number }
    | undefined;

  const bodyChanged = !existing || existing.body !== p.record.body;
  const titleZh = bodyChanged ? p.titleZh : existing!.title_zh || p.titleZh;
  const summary = bodyChanged ? p.summary : existing!.summary || p.summary;
  const whyItMatters = bodyChanged ? p.whyItMatters : existing!.why_it_matters || p.whyItMatters;
  const enriched = bodyChanged ? 0 : existing!.enriched;

  db.prepare(`
    INSERT OR REPLACE INTO articles
      (id, source_id, source_name, channel, title, title_zh, excerpt, body, url,
       summary, why_it_matters, published_at, crawled_at, tags, region, imagery_modes, composite_score, image, enriched)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    p.record.id,
    p.record.sourceId,
    p.record.sourceName,
    p.record.channel,
    p.record.title,
    titleZh,
    p.record.excerpt,
    p.record.body,
    p.record.url,
    summary,
    whyItMatters,
    p.record.publishedAt,
    Date.now(),
    p.record.tags.join(","),
    p.record.region,
    p.record.imageryModes.join(","),
    p.compositeScore,
    p.record.image ?? "",
    enriched,
  );
  return !existing;
}

/**
 * Normalize a URL for duplicate detection: lowercase host, drop the query
 * string / fragment and any trailing slash. Two records that point at the same
 * canonical article (e.g. with/without utm params or a trailing slash) collapse
 * to one key. Falls back to the raw string when the URL can't be parsed.
 */
export function normalizeUrl(raw: string): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.toLowerCase()}${path}`;
  } catch {
    return raw.split("?")[0].replace(/\/+$/, "").toLowerCase();
  }
}

/** Mark an article enriched and store its LLM title / summary / why. */
export function markEnriched(
  id: string,
  fields: { titleZh: string; summary: string; whyItMatters: string },
): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    "UPDATE articles SET title_zh = ?, summary = ?, why_it_matters = ?, enriched = 1 WHERE id = ?",
  ).run(fields.titleZh, fields.summary, fields.whyItMatters, id);
}

/**
 * Articles awaiting async LLM enrichment (title translation + summary), highest
 * composite_score first so the most-visible items become Chinese soonest.
 * Excludes mock seeds (already curated Chinese).
 */
export function listUnenrichedArticles(limit = 40): StoredArticle[] {
  const db = getDb();
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT * FROM articles
       WHERE channel != 'mock' AND enriched = 0
       ORDER BY composite_score DESC, crawled_at DESC LIMIT ?`,
    )
    .all(limit) as DbRow[];
  return rows.map(rowToArticle);
}

/**
 * Collapse rows that point at the same canonical URL (e.g. left over from an
 * older id scheme). Keeps the highest composite_score, newest crawl as
 * tiebreaker; deletes the rest. Returns the number of rows removed.
 */
export function dedupeByUrl(): number {
  const db = getDb();
  if (!db) return 0;
  const rows = db
    .prepare("SELECT id, url, composite_score, crawled_at FROM articles")
    .all() as Array<{ id: string; url: string; composite_score: number; crawled_at: number }>;

  const keepByKey = new Map<string, { id: string; composite_score: number; crawled_at: number }>();
  const toDelete: string[] = [];
  for (const r of rows) {
    const key = normalizeUrl(r.url);
    const cur = keepByKey.get(key);
    if (!cur) {
      keepByKey.set(key, r);
    } else if (
      r.composite_score > cur.composite_score ||
      (r.composite_score === cur.composite_score && r.crawled_at > cur.crawled_at)
    ) {
      toDelete.push(cur.id);
      keepByKey.set(key, r);
    } else {
      toDelete.push(r.id);
    }
  }
  if (!toDelete.length) return 0;
  const del = db.prepare("DELETE FROM articles WHERE id = ?");
  const tx = db.transaction((ids: string[]) => ids.forEach((id) => del.run(id)));
  tx(toDelete);
  return toDelete.length;
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

/**
 * Delete articles older than `keepDays`. Retention is deliberately long (90d):
 * the full crawl history is kept as a corpus for future retrieval / rerank
 * even though the dashboard only renders the most recent 48h window.
 */
export function pruneOldArticles(keepDays = 90): number {
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
