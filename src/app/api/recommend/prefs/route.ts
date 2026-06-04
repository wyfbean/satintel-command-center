/**
 * GET  /api/recommend/prefs?sid=<uuid>
 *   Returns the session's top preferences (decay-adjusted weights), for display
 *   in the "我的偏好" UI strip.
 *
 * DELETE /api/recommend/prefs?sid=<uuid>
 *   Clears all stored preferences and events for this session.
 */

import { NextResponse } from "next/server";
import { getPreferences, clearPreferences } from "@/lib/intel/reranker";

export const dynamic = "force-dynamic";

const HALF_LIFE_DAYS = 5;

function applyDecay(weight: number, lastUpdatedMs: number): number {
  const daysSince = (Date.now() - lastUpdatedMs) / 86_400_000;
  return weight * Math.pow(0.5, daysSince / HALF_LIFE_DAYS);
}

export async function GET(req: Request) {
  const sid = new URL(req.url).searchParams.get("sid") ?? "";
  if (!sid) return NextResponse.json([]);

  const raw = getPreferences(sid);

  // Return decay-adjusted weights so the UI shows realistic current strength
  const decayed = raw
    .map((p) => ({
      featureType:  p.featureType,
      featureValue: p.featureValue,
      weight:       Math.round(applyDecay(p.weight, p.lastUpdated) * 100) / 100,
    }))
    .filter((p) => p.weight >= 0.05)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12);

  return NextResponse.json(decayed);
}

export async function DELETE(req: Request) {
  const sid = new URL(req.url).searchParams.get("sid") ?? "";
  if (!sid) return NextResponse.json({ ok: false, error: "sid required" }, { status: 400 });
  clearPreferences(sid);
  return NextResponse.json({ ok: true });
}
