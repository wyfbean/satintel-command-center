/**
 * GET  /api/recommend/history
 *   Returns the authenticated user's 30 most recently clicked articles,
 *   deduplicated by article (most recent click per article shown).
 *
 * DELETE /api/recommend/history
 *   Clears the raw click log (user_events) for this user.
 *   Intentionally leaves user_interests intact so preferences survive a
 *   history purge — use DELETE /api/recommend/prefs to wipe everything.
 *
 * Auth-only: anonymous sessions have no persistent identity for history.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/intel/db";

export const dynamic = "force-dynamic";

type Row = {
  article_id:  string;
  event_type:  string;
  created_at:  number;
  title:       string;
  title_zh:    string;
  source_name: string;
  url:         string;
};

export async function GET() {
  const session = await auth();
  const userId  = session?.user?.id;
  if (!userId) return NextResponse.json([]);

  const db = getDb();
  if (!db) return NextResponse.json([]);

  const rows = db.prepare(`
    SELECT e.article_id,
           e.event_type,
           MAX(e.created_at)          AS created_at,
           COALESCE(a.title,       '') AS title,
           COALESCE(a.title_zh,    '') AS title_zh,
           COALESCE(a.source_name, '') AS source_name,
           COALESCE(a.url,         '') AS url
    FROM user_events e
    LEFT JOIN articles a ON a.id = e.article_id
    WHERE e.session_id = ?
    GROUP BY e.article_id
    ORDER BY MAX(e.created_at) DESC
    LIMIT 30
  `).all(userId) as Row[];

  return NextResponse.json(
    rows.map((r) => ({
      articleId:  r.article_id,
      eventType:  r.event_type,
      createdAt:  r.created_at,
      title:      r.title,
      titleZh:    r.title_zh,
      sourceName: r.source_name,
      url:        r.url,
    })),
  );
}

export async function DELETE() {
  const session = await auth();
  const userId  = session?.user?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ ok: true });

  db.prepare("DELETE FROM user_events WHERE session_id = ?").run(userId);
  return NextResponse.json({ ok: true });
}
