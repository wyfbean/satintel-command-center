import { NextResponse } from "next/server";
import { removeFeed, updateFeed } from "@/lib/intel/rss-store";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  removeFeed(id);
  return NextResponse.json({ deleted: id });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { url?: string; name?: string; tags?: string[] };
  const updated = updateFeed(id, body);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}
