import { NextResponse } from "next/server";

import { generateChatAnswer } from "@/lib/intel/llm";
import { getDashboardData } from "@/lib/intel/service";
import type { ChatMessage } from "@/types/intel";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    messages?: ChatMessage[];
    selectedIds?: string[];
    missionContext?: string;
  };

  const dashboard = await getDashboardData();
  const selectedIds = payload.selectedIds ?? [];
  const contextItems =
    selectedIds.length > 0
      ? dashboard.items.filter((item) => selectedIds.includes(item.id))
      : dashboard.items.slice(0, 3);

  const answer = await generateChatAnswer({
    messages: payload.messages ?? [],
    contextItems,
    missionContext: payload.missionContext,
  });

  return NextResponse.json({ answer });
}
