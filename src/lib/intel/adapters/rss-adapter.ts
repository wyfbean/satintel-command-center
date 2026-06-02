import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";

import type { SourceAdapter } from "@/lib/intel/adapters/base";
import type { IntelSource, RawIntelRecord } from "@/types/intel";

function stripHtml(input: string) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function guessModes(text: string): Array<"RGB" | "SAR" | "MS"> {
  const lower = text.toLowerCase();
  const modes = new Set<"RGB" | "SAR" | "MS">();

  if (/(sar|radar|synthetic aperture)/.test(lower)) modes.add("SAR");
  if (/(multispectral|hyperspectral|spectral)/.test(lower)) modes.add("MS");
  if (/(optical|visible|imagery|earth observation|eo)/.test(lower)) modes.add("RGB");

  if (modes.size === 0) {
    modes.add("RGB");
  }

  return Array.from(modes);
}

function normalizeItems(items: unknown) {
  if (Array.isArray(items)) return items;
  if (items) return [items];
  return [];
}

function firstUrlAttr(node: unknown): string | undefined {
  // media:content / media:thumbnail / enclosure may be a single object or an array.
  const candidates = Array.isArray(node) ? node : node ? [node] : [];
  for (const entry of candidates) {
    const obj = entry as { url?: unknown; type?: unknown } | undefined;
    const url = obj?.url;
    if (typeof url === "string" && url.trim()) {
      const type = typeof obj?.type === "string" ? obj.type : "";
      // For enclosures, only accept image types; media:* tags are images by intent.
      if (!type || type.startsWith("image/")) return url.trim();
    }
  }
  return undefined;
}

/** Best-effort thumbnail extraction from an RSS/Atom item. */
function extractImage(item: Record<string, unknown>, rawHtml: string): string | undefined {
  return (
    firstUrlAttr(item["media:content"]) ??
    firstUrlAttr(item["media:thumbnail"]) ??
    firstUrlAttr(item.enclosure) ??
    rawHtml.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]?.trim() ??
    undefined
  );
}

export class RssAdapter implements SourceAdapter {
  kind: IntelSource["kind"] = "rss";

  async collect(source: IntelSource): Promise<RawIntelRecord[]> {
    if (!source.url) {
      return [];
    }

    const response = await fetch(source.url, {
      // no-store: always fetch fresh XML — never reuse Next.js's server-side
      // fetch cache. Without this the ingestion worker keeps seeing the same
      // stale feed response on every 30-minute cycle.
      cache: "no-store",
      headers: {
        "user-agent": "SatIntelCommandCenter/1.0",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });

    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      parseTagValue: true,
    });

    const feed = parser.parse(xml);
    const channelItems = normalizeItems(feed?.rss?.channel?.item ?? feed?.feed?.entry);

    return channelItems.slice(0, 20).map((item: Record<string, unknown>) => {
      const title = String(item.title ?? "Untitled signal");
      const rawSummary =
        String(item.description ?? item.summary ?? item["content:encoded"] ?? "") ||
        "No summary was provided in this feed entry.";
      const linkValue = item.link;
      const url =
        typeof linkValue === "string"
          ? linkValue
          : String((linkValue as { href?: string })?.href ?? source.url ?? "");
      const body = stripHtml(rawSummary).slice(0, 900);
      const image = extractImage(item, rawSummary);

      // ID is a stable hash of source + URL so the same article never creates a
      // duplicate row even when it shifts positions in the feed.
      const stableKey = `${source.id}::${url || title}`;
      const id = `${source.id}-${crypto.createHash("sha256").update(stableKey).digest("hex").slice(0, 14)}`;

      return {
        id,
        sourceId: source.id,
        sourceName: source.name,
        channel: "rss",
        title,
        excerpt: body.slice(0, 220),
        body,
        url,
        publishedAt: String(item.pubDate ?? item.published ?? item.updated ?? new Date().toISOString()),
        tags: source.tags,
        region: source.region,
        imageryModes: guessModes(`${title} ${body}`),
        image,
      } satisfies RawIntelRecord;
    });
  }
}
