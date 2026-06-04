/**
 * POST /api/recommend/migrate
 * Body: { anonymousSid: string }
 *
 * Merges the click/preference history from an anonymous localStorage session
 * into the authenticated user's UUID. Called once on first login by the client.
 *
 * Idempotent: if anonymousSid === userId (already migrated), returns immediately.
 * Weights are additive so a re-fire never doubles the values.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/intel/db";

export const dynamic = "force-dynamic";

type Body = { anonymousSid?: string };

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = (await req.json().catch(() => ({}))) as Body;
  const { anonymousSid } = body;

  if (!anonymousSid) {
    return NextResponse.json({ error: "anonymousSid required" }, { status: 400 });
  }

  // Guard: anonymousSid is already the userId → migration already ran.
  if (anonymousSid === userId) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ ok: true }); // DB unavailable — silent no-op

  // Security: refuse if anonymousSid matches a real users.id.
  // Genuine anonymous UUIDs are never in the users table; if it IS a real user ID
  // then the caller is attempting to drain another user's preference data.
  const isRealUser = db.prepare("SELECT id FROM users WHERE id = ?").get(anonymousSid);
  if (isRealUser) {
    return NextResponse.json({ error: "invalid anonymousSid" }, { status: 400 });
  }

  db.transaction(() => {
    // 1. Re-key raw event log
    db.prepare(
      "UPDATE user_events SET session_id = ? WHERE session_id = ?",
    ).run(userId, anonymousSid);

    // 2. Accumulate preference weights into the user's row (additive merge)
    db.prepare(`
      INSERT INTO user_interests (session_id, feature_type, feature_value, weight, last_updated)
      SELECT ?, feature_type, feature_value, weight, last_updated
      FROM user_interests WHERE session_id = ?
      ON CONFLICT(session_id, feature_type, feature_value)
      DO UPDATE SET
        weight       = weight + excluded.weight,
        last_updated = MAX(last_updated, excluded.last_updated)
    `).run(userId, anonymousSid);

    // 3. Remove the now-merged anonymous rows
    db.prepare("DELETE FROM user_interests WHERE session_id = ?").run(anonymousSid);
  })();

  return NextResponse.json({ ok: true });
}
