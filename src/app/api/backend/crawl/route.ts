import { NextResponse } from "next/server";

import { runMockBackendIngestion } from "@/lib/backend/mock-backend";

export async function POST() {
  const run = await runMockBackendIngestion(["rss", "crawl", "wechat-url"]);

  return NextResponse.json({
    generatedAt: run.generatedAt,
    reports: run.reports,
    records: run.records,
  });
}
