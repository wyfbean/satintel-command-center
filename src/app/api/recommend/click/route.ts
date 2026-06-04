/**
 * POST /api/recommend/click
 * Body: { articleId: string, sid: string, weight?: number }
 *
 * weight = 1  → plain click (user opened the article)
 * weight = 2  → dwell     (user read ≥ DWELL_THRESHOLD_MS seconds)
 *
 * Looks up the article in the DB to extract its tags / region / source,
 * then calls recordClick() to update the session's preference weights.
 * Returns { ok: true } synchronously; the UI fires this as fire-and-forget.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/intel/db";
import { recordClick } from "@/lib/intel/reranker";

export const dynamic = "force-dynamic";

type Body = { articleId?: string; sid?: string; weight?: number };

type ArticleRow = {
  tags:        string;
  region:      string;
  source_name: string;
  title:       string;
  title_zh:    string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const { articleId, sid, weight = 1 } = body;

  if (!articleId || !sid) {
    return NextResponse.json({ ok: false, error: "articleId and sid required" }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ ok: true }); // DB unavailable — silent no-op

  const row = db
    .prepare("SELECT tags, region, source_name, title, title_zh FROM articles WHERE id = ? LIMIT 1")
    .get(articleId) as ArticleRow | undefined;

  if (row) {
    // Extract entities from title for KG expansion (simple word tokens ≥ 4 chars)
    const titleText = (row.title_zh || row.title).replace(/[^\w\s]/g, " ");
    const entities  = titleText.split(/\s+/).filter((t) => t.length >= 4);

    recordClick(
      sid,
      {
        id:               articleId,
        tags:             row.tags ? row.tags.split(",").filter(Boolean) : [],
        region:           row.region,
        sourceName:       row.source_name,
        extractedEntities: entities,
      },
      weight,
    );
  }

  return NextResponse.json({ ok: true });
}
