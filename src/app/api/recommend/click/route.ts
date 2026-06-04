/**
 * POST /api/recommend/click
 * Body: { articleId: string, sid: string, weight?: number }
 *
 * weight = 1  → plain click (user opened the article detail panel)
 * weight = 2  → dwell     (user read ≥ DWELL_THRESHOLD_MS seconds)
 *
 * Authenticated users: session userId overrides the body `sid`.
 * Anonymous users: body `sid` is used as-is (localStorage UUID fallback).
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/intel/db";
import { recordClick } from "@/lib/intel/reranker";
import { auth } from "@/auth";

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
  const { articleId, weight = 1 } = body;

  // Authenticated session takes priority over client-supplied sid.
  const session      = await auth();
  const userId       = session?.user?.id;
  const effectiveSid = userId ?? body.sid ?? "";

  if (!articleId || !effectiveSid) {
    return NextResponse.json({ ok: false, error: "articleId and sid required" }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ ok: true }); // DB unavailable — silent no-op

  const row = db
    .prepare("SELECT tags, region, source_name, title, title_zh FROM articles WHERE id = ? LIMIT 1")
    .get(articleId) as ArticleRow | undefined;

  if (row) {
    const titleText = (row.title_zh || row.title).replace(/[^\w\s]/g, " ");
    const entities  = titleText.split(/\s+/).filter((t) => t.length >= 4);

    recordClick(
      effectiveSid,
      {
        id:                articleId,
        tags:              row.tags ? row.tags.split(",").filter(Boolean) : [],
        region:            row.region,
        sourceName:        row.source_name,
        extractedEntities: entities,
      },
      weight,
    );
  }

  return NextResponse.json({ ok: true });
}
