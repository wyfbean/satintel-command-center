import type { SourceAdapter } from "@/lib/intel/adapters/base";
import type { IntelSource, RawIntelRecord } from "@/types/intel";

function pickMeta(html: string, name: string) {
  const expression = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  return html.match(expression)?.[1]?.trim() ?? "";
}

function pickTitle(html: string) {
  return (
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
    pickMeta(html, "og:title") ||
    "WeChat signal"
  );
}

function pickText(html: string) {
  const paragraphs = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gi)]
    .map((entry) => entry[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((entry) => entry.length > 24);

  return paragraphs.slice(0, 4).join(" ");
}

export class WechatUrlAdapter implements SourceAdapter {
  kind: IntelSource["kind"] = "wechat-url";

  async collect(source: IntelSource): Promise<RawIntelRecord[]> {
    if (!source.urls?.length) {
      return [];
    }

    const settled = await Promise.allSettled(
      source.urls.map(async (url, index) => {
        const response = await fetch(url, {
          next: { revalidate: 1800 },
          headers: {
            "user-agent": "SatIntelCommandCenter/1.0",
          },
        });

        if (!response.ok) {
          return null;
        }

        const html = await response.text();
        const title = pickTitle(html);
        const description = pickMeta(html, "description") || pickMeta(html, "og:description");
        const body = pickText(html) || description || "No public text was extracted from this WeChat article.";

        return {
          id: `${source.id}-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          sourceId: source.id,
          sourceName: source.name,
          channel: "wechat-url",
          title,
          excerpt: description || body.slice(0, 200),
          body,
          url,
          publishedAt: new Date().toISOString(),
          tags: [...source.tags, "WeChat"],
          region: source.region,
          imageryModes: ["RGB", "SAR", "MS"],
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
