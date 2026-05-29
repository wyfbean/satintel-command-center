import type { SourceAdapter } from "@/lib/intel/adapters/base";
import type { IntelSource, RawIntelRecord } from "@/types/intel";

function stripTags(input: string) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function pickMeta(html: string, name: string) {
  const expression = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  return html.match(expression)?.[1]?.trim() ?? "";
}

function pickTitle(html: string) {
  return (
    stripTags(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "") ||
    pickMeta(html, "og:title") ||
    pickMeta(html, "twitter:title") ||
    "Crawled signal"
  );
}

function pickText(html: string) {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const scopedHtml = articleMatch || html;
  const paragraphs = [...scopedHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((entry) => stripTags(entry[1]))
    .filter((entry) => entry.length > 32);

  return paragraphs.slice(0, 6).join(" ");
}

function guessModes(text: string): Array<"RGB" | "SAR" | "MS"> {
  const lower = text.toLowerCase();
  const modes = new Set<"RGB" | "SAR" | "MS">();

  if (/(sar|radar|synthetic aperture|雷达)/.test(lower)) modes.add("SAR");
  if (/(multispectral|hyperspectral|spectral|多光谱|高光谱)/.test(lower)) modes.add("MS");
  if (/(optical|visible|imagery|earth observation|遥感|影像|光学)/.test(lower)) modes.add("RGB");

  return modes.size ? Array.from(modes) : ["RGB"];
}

export class CrawlAdapter implements SourceAdapter {
  kind: IntelSource["kind"] = "crawl";

  async collect(source: IntelSource): Promise<RawIntelRecord[]> {
    if (!source.urls?.length) {
      return [];
    }

    const settled = await Promise.allSettled(
      source.urls.map(async (url, index) => {
        const response = await fetch(url, {
          next: { revalidate: 1800 },
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": "SatIntelCommandCenter/1.0 (+mock-backend)",
          },
        });

        if (!response.ok) {
          return null;
        }

        const html = await response.text();
        const title = pickTitle(html);
        const description = pickMeta(html, "description") || pickMeta(html, "og:description");
        const body = pickText(html) || description || "No public article text was extracted from this page.";
        const normalizedBody = body.slice(0, 1200);

        return {
          id: `${source.id}-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          sourceId: source.id,
          sourceName: source.name,
          channel: "crawl",
          title,
          excerpt: (description || normalizedBody).slice(0, 240),
          body: normalizedBody,
          url,
          publishedAt: new Date().toISOString(),
          tags: source.tags,
          region: source.region,
          imageryModes: guessModes(`${title} ${normalizedBody}`),
        } satisfies RawIntelRecord;
      }),
    );

    return settled.flatMap((result) => {
      if (result.status !== "fulfilled" || !result.value) {
        return [];
      }

      return [result.value];
    });
  }
}
