/**
 * POST /api/recommend/click
 * Body: { articleId: string, sid: string }
 *
 * Looks up the article in the DB to extract its tags / region / source,
 * then calls recordClick() to update the session's preference weights.
 * Returns { ok: true } synchronously; the UI fires this as fire-and-forget.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/intel/db";
import { recordClick } from "@/lib/intel/reranker";

export const dynamic = "force-dynamic";

type Body = { articleId?: string; sid?: string };

type ArticleRow = {
  tags:        string;
  region:      string;
  source_name: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const { articleId, sid } = body;

  if (!articleId || !sid) {
    return NextResponse.json({ ok: false, error: "articleId and sid required" }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ ok: true }); // DB unavailable — silent no-op

  const row = db
    .prepare("SELECT tags, region, source_name FROM articles WHERE id = ? LIMIT 1")
    .get(articleId) as ArticleRow | undefined;

  if (row) {
    recordClick(sid, {
      id:         articleId,
      tags:       row.tags ? row.tags.split(",").filter(Boolean) : [],
      region:     row.region,
      sourceName: row.source_name,
    });
  }

  return NextResponse.json({ ok: true });
}
