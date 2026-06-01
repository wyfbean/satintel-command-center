import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/intel/service";
import { ensureScheduler } from "@/lib/intel/scheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  // Start the background scheduler on the first real request (never at build time).
  ensureScheduler();
  const data = await getDashboardData();
  return NextResponse.json(data);
}
