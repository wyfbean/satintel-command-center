/**
 * Content-Based Re-ranking with click-derived user preferences.
 *
 * Algorithm (v0.1):
 *   rerankedScore(item) = compositeScore(item) + boost(prefs, item)
 *
 *   boost = Σ decay(w_f) × FEATURE_WEIGHTS[type]
 *           for each preference f that matches a feature of item
 *
 *   decay(w, lastUpdatedMs) = w × 0.5^(daysSince / HALF_LIFE_DAYS)
 *
 * Feature types extracted from each clicked article:
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
 * Records a click in user_events and upserts aggregated weights in
 * user_interests (+1 per feature of the clicked article).
 */
export function recordClick(sessionId: string, article: {
  id: string;
  tags: string[];
  region: string;
  sourceName: string;
}): void {
  const db = getDb();
  if (!db || !sessionId) return;

  const now = Date.now();

  // 1. raw event log
  db.prepare(
    "INSERT INTO user_events (session_id, article_id, event_type, created_at) VALUES (?, ?, 'click', ?)",
  ).run(sessionId, article.id, now);

  // 2. upsert aggregated preferences (weight += 1 per feature)
  const upsert = db.prepare(`
    INSERT INTO user_interests (session_id, feature_type, feature_value, weight, last_updated)
    VALUES (?, ?, ?, 1.0, ?)
    ON CONFLICT(session_id, feature_type, feature_value)
    DO UPDATE SET weight = weight + 1.0, last_updated = excluded.last_updated
  `);

  const run = db.transaction(() => {
    for (const tag of article.tags.slice(0, 6)) {
      if (tag) upsert.run(sessionId, "tag", tag, now);
    }
    if (article.region)     upsert.run(sessionId, "region", article.region,     now);
    if (article.sourceName) upsert.run(sessionId, "source", article.sourceName, now);
  });
  run();
}
