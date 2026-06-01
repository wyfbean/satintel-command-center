/**
 * AI-generated content adapter.
 *
 * When an LLM key is configured, calls generateAiArticles() which prompts the
 * model for a batch of plausible satellite/EO industry news items.  Results are
 * cached 2 hours so the model isn't called on every feed reload.
 *
 * When no LLM key is configured this adapter returns an empty array — the mock
 * adapter already supplies seed data, so the page is never blank.
 */

import { generateAiArticles } from "@/lib/intel/llm";
import type { SourceAdapter } from "@/lib/intel/adapters/base";
import type { IntelSource, RawIntelRecord } from "@/types/intel";
import crypto from "crypto";

function stableId(sourceId: string, title: string): string {
  const hash = crypto.createHash("sha256").update(`${sourceId}:${title}`).digest("hex").slice(0, 16);
  return `ai-${hash}`;
}

export class AiCrawlerAdapter implements SourceAdapter {
  kind: IntelSource["kind"] = "ai-generated";

  async collect(source: IntelSource): Promise<RawIntelRecord[]> {
    const articles = await generateAiArticles(6);
    if (!articles.length) return [];

    const now = new Date().toISOString();
    return articles.map((a) => ({
      id: stableId(source.id, a.title),
      sourceId: source.id,
      sourceName: source.name,
      channel: "ai-generated" as const,
      title: a.title,
      excerpt: a.body.slice(0, 200),
      body: a.body,
      url: `https://satintel.internal/ai/${stableId(source.id, a.title)}`,
      publishedAt: now,
      tags: Array.isArray(a.tags) ? a.tags.slice(0, 5) : [],
      region: a.region || "全球",
      imageryModes: Array.isArray(a.imageryModes) ? a.imageryModes : ["RGB"],
    } satisfies RawIntelRecord));
  }
}
