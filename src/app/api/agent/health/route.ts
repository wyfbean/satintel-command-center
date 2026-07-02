import { NextRequest, NextResponse } from "next/server";

const CREW_BACKEND = process.env.AGENT_BACKEND_URL?.replace(/\/agent\/?$/, "") ?? "http://127.0.0.1:6008";
// By default the orchestrator is served by the same backend process under /orchestrator
// (probed at /orchestrator/health). Stripping the trailing `/agent` from an explicit
// ORCHESTRATOR_BACKEND_URL keeps a split-host prod override working.
const ORCHESTRATOR_BACKEND =
  process.env.ORCHESTRATOR_BACKEND_URL?.replace(/\/agent\/?$/, "") ?? "http://127.0.0.1:6008/orchestrator";

/** Server-side probe of the agent backends so the /orchestration page can show an offline hint.
 *  `?backend=orchestrator` checks the Magnetic-One model-wrapper orchestrator instead of the CrewAI crew. */
export async function GET(req: NextRequest) {
  const backend = req.nextUrl.searchParams.get("backend") === "orchestrator" ? ORCHESTRATOR_BACKEND : CREW_BACKEND;
  try {
    const res = await fetch(`${backend}/health`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ ok: false });
    const data = (await res.json()) as { status?: string; mode?: string };
    return NextResponse.json({ ok: data.status === "ok", mode: data.mode ?? "unknown" });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
