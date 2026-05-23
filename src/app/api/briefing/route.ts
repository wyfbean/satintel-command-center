import { NextResponse } from "next/server";

import { generateBriefing } from "@/lib/intel/llm";
import { getDashboardData } from "@/lib/intel/service";

export async function GET() {
  const data = await getDashboardData();
  const briefing = await generateBriefing(data.items);

  return NextResponse.json({ briefing });
}
