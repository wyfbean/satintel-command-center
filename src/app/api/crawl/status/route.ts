import { NextResponse } from "next/server";
import { getSchedulerStatus } from "@/lib/intel/scheduler";
import { listRecentRuns, countRecentArticles } from "@/lib/intel/article-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const since48h = Date.now() - 48 * 3600 * 1000;
  return NextResponse.json({
    scheduler: getSchedulerStatus(),
    recentArticles: countRecentArticles(since48h),
    recentRuns: listRecentRuns(5),
  });
}
