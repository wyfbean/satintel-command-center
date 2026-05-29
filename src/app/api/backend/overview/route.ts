import { NextResponse } from "next/server";

import { getBackendOverview, listBackendSources } from "@/lib/backend/mock-backend";

export async function GET() {
  return NextResponse.json({
    ...getBackendOverview(),
    sources: listBackendSources(),
  });
}
