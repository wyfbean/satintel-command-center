/**
 * Content-Based Re-ranking with click-derived user preferences.
 *
 * Algorithm (v0.2):
 *   rerankedScore(item) = compositeScore(item) + boost(prefs, item)
 *
 *   boost = Σ decay(w_f) × FEATURE_WEIGHTS[type]
 *           for each preference f that matches a feature of item
 *
 *   decay(w, lastUpdatedMs) = w × 0.5^(daysSince / HALF_LIFE_DAYS)
 *
 * Signal strengths (weight added per event):
 *   click (+1)  — user opened the article detail panel
 *   dwell (+2)  — user read the article for ≥ DWELL_THRESHOLD_MS seconds
 *
 * Feature types extracted from each event:
 *   - tag    (0.12 each) — broad topic signal
 *   - region (0.20)      — geographic focus
 *   - source (0.08)      — source preference (weakest, editorial bias risk)
 *
 * boost is capped at MAX_BOOST so fresh / high-relevance content is never
 * completely buried by preference history.
 */

import { getDb } from "@/lib/intel/db";
import type { IntelItem } from "@/types/intel";

/* ── tuning knobs ─────────────────────────────────────────────────── */

const FEATURE_WEIGHTS: Record<string, number> = {
  tag:    0.12,
  region: 0.20,
  source: 0.08,
};
const MAX_BOOST        = 0.40;   // cap; compositeScore range is ~0.35–1.0
const HALF_LIFE_DAYS   = 5;      // preferences halve every 5 days
const MAX_PREFS        = 100;    // read at most N rows per session (perf guard)

/* ── types ────────────────────────────────────────────────────────── */

export type UserInterest = {
  featureType:  string;
  featureValue: string;
  weight:       number;
  lastUpdated:  number;   // unix ms
};

type DbInterestRow = {
  feature_type:  string;
  feature_value: string;
  weight:        number;
  last_updated:  number;
};

/* ── decay helper ─────────────────────────────────────────────────── */

function applyDecay(weight: number, lastUpdatedMs: number): number {
  const daysSince = (Date.now() - lastUpdatedMs) / 86_400_000;
  return weight * Math.pow(0.5, daysSince / HALF_LIFE_DAYS);
}

/* ── boost computation ────────────────────────────────────────────── */

function computeBoost(prefs: UserInterest[], item: IntelItem): number {
  if (!prefs.length) return 0;
  let raw = 0;
  for (const p of prefs) {
    const w = applyDecay(p.weight, p.lastUpdated);
    if (w < 0.001) continue;   // effectively zero after decay — skip
    const fw = FEATURE_WEIGHTS[p.featureType] ?? 0;
    if (p.featureType === "tag"    && item.tags.includes(p.featureValue)) raw += w * fw;
    if (p.featureType === "region" && item.region === p.featureValue)     raw += w * fw;
    if (p.featureType === "source" && item.sourceName === p.featureValue) raw += w * fw;
  }
  return Math.min(raw, MAX_BOOST);
}

/* ── public: re-rank ─────────────────────────────────────────────── */

/**
 * Returns items sorted by (compositeScore + personalisation boost).
 * Falls through instantly with the original order when prefs are empty.
 */
export function rerank(items: IntelItem[], prefs: UserInterest[]): IntelItem[] {
  if (!prefs.length) return items;
  return [...items].sort(
    (a, b) =>
      (b.compositeScore + computeBoost(prefs, b)) -
      (a.compositeScore + computeBoost(prefs, a)),
  );
}

/* ── public: read preferences ────────────────────────────────────── */

export function getPreferences(sessionId: string): UserInterest[] {
  const db = getDb();
  if (!db || !sessionId) return [];
  const rows = db
    .prepare(
      `SELECT feature_type, feature_value, weight, last_updated
       FROM user_interests
       WHERE session_id = ?
       ORDER BY weight DESC
       LIMIT ?`,
    )
    .all(sessionId, MAX_PREFS) as DbInterestRow[];

  return rows.map((r) => ({
    featureType:  r.feature_type,
    featureValue: r.feature_value,
    weight:       r.weight,
    lastUpdated:  r.last_updated,
  }));
}

/* ── public: record a click ──────────────────────────────────────── */

/**
 * Records an event in user_events and upserts aggregated weights.
 *
 * @param weight  1 for a plain click; 2 for a dwell (user read ≥ threshold).
 *                Passing a higher weight directly encodes signal strength so
 *                callers don't need to know the internal schema.
 */
export function recordClick(
  sessionId: string,
  article: { id: string; tags: string[]; region: string; sourceName: string },
  weight = 1,
): void {
  const db = getDb();
  if (!db || !sessionId) return;

  const now      = Date.now();
  const safeW    = Math.max(1, Math.min(weight, 3));   // clamp 1–3
  const evType   = safeW > 1 ? "dwell" : "click";

  // 1. raw event log
  db.prepare(
    "INSERT INTO user_events (session_id, article_id, event_type, created_at) VALUES (?, ?, ?, ?)",
  ).run(sessionId, article.id, evType, now);

  // 2. upsert aggregated preferences
  const upsert = db.prepare(`
    INSERT INTO user_interests (session_id, feature_type, feature_value, weight, last_updated)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, feature_type, feature_value)
    DO UPDATE SET weight = weight + excluded.weight, last_updated = excluded.last_updated
  `);

  const run = db.transaction(() => {
    for (const tag of article.tags.slice(0, 6)) {
      if (tag) upsert.run(sessionId, "tag", tag, safeW, now);
    }
    if (article.region)     upsert.run(sessionId, "region", article.region,     safeW, now);
    if (article.sourceName) upsert.run(sessionId, "source", article.sourceName, safeW, now);
  });
  run();
}

/* ── public: clear preferences ───────────────────────────────────── */

/** Delete all stored preferences for a session (user-triggered reset). */
export function clearPreferences(sessionId: string): void {
  const db = getDb();
  if (!db || !sessionId) return;
  db.prepare("DELETE FROM user_interests WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM user_events    WHERE session_id = ?").run(sessionId);
}
