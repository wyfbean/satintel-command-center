import { NextResponse } from "next/server";
import crypto from "crypto";
import { listFeeds, addFeed, type UserFeed } from "@/lib/intel/rss-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listFeeds());
}

export async function POST(req: Request) {
  const body = (await req.json()) as { url?: string; name?: string; tags?: string[] };
  if (!body.url?.startsWith("http")) {
    return NextResponse.json({ error: "url is required and must start with http" }, { status: 400 });
  }
  const id = "user-" + crypto.createHash("sha256").update(body.url).digest("hex").slice(0, 12);
  const feed: Omit<UserFeed, "addedAt"> = {
    id,
    url: body.url.trim(),
    name: body.name?.trim() || body.url.trim(),
    tags: Array.isArray(body.tags) ? body.tags : [],
  };
  return NextResponse.json(addFeed(feed), { status: 201 });
}
