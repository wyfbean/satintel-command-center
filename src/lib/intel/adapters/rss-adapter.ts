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

export class RssAdapter implements SourceAdapter {
  kind: IntelSource["kind"] = "rss";

  async collect(source: IntelSource): Promise<RawIntelRecord[]> {
    if (!source.url) {
      return [];
    }

    const response = await fetch(source.url, {
      next: { revalidate: 1800 },
      headers: {
        "user-agent": "SatIntelCommandCenter/1.0",
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

    return channelItems.slice(0, 6).map((item: Record<string, unknown>, index: number) => {
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

      return {
        id: `${source.id}-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
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
      } satisfies RawIntelRecord;
    });
  }
}
