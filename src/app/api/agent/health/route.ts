import { NextResponse } from "next/server";

const BACKEND = process.env.AGENT_BACKEND_URL?.replace(/\/agent\/?$/, "") ?? "http://127.0.0.1:8000";

/** Server-side probe of the CrewAI backend so the /orchestration page can show an offline hint. */
export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/health`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ ok: false });
    const data = (await res.json()) as { status?: string; mode?: string };
    return NextResponse.json({ ok: data.status === "ok", mode: data.mode ?? "unknown" });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
