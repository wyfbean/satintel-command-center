import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";

export const dynamic = "force-dynamic";

function normalizeItems(items: unknown) {
  if (Array.isArray(items)) return items;
  if (items) return [items];
  return [];
}

export async function POST(req: Request) {
  const body = (await req.json()) as { url?: string };
  if (!body.url?.startsWith("http")) {
    return NextResponse.json({ error: "url 无效" }, { status: 400 });
  }

  try {
    const res = await fetch(body.url, {
      headers: { "user-agent": "SatIntelCommandCenter/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 422 });

    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
    const feed = parser.parse(xml);
    const items = normalizeItems(feed?.rss?.channel?.item ?? feed?.feed?.entry);
    const title: string =
      String(feed?.rss?.channel?.title ?? feed?.feed?.title ?? "").slice(0, 80) || body.url;

    return NextResponse.json({ count: items.length, title });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: `无法访问：${msg}` }, { status: 422 });
  }
}
