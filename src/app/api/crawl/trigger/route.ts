import { NextResponse } from "next/server";
import { runIngestionCycle } from "@/lib/intel/ingestion-worker";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await runIngestionCycle();
  return NextResponse.json(result);
}
