import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/intel/service";
import { ensureScheduler } from "@/lib/intel/scheduler";
import { getPreferences, epsilonGreedy } from "@/lib/intel/reranker";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Start the background scheduler on the first real request (never at build time).
  ensureScheduler();

  const data = await getDashboardData();

  // Personalise: authenticated userId takes priority over ?sid= query param.
  // Falls through instantly (same order) when sid is absent or prefs are empty.
  const session = await auth();
  const userId  = session?.user?.id;
  const sid     = userId ?? (new URL(req.url).searchParams.get("sid") ?? "");

  if (sid) {
    const prefs = getPreferences(sid);
    if (prefs.length) {
      // epsilonGreedy wraps rerank: (1-ε) personalised exploitation +
      // ε random exploration of editorially-strong unseen items.
      data.items = epsilonGreedy(data.items, prefs);
    }
  }

  return NextResponse.json(data);
}
