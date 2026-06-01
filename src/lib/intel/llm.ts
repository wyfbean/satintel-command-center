import OpenAI from "openai";

import type { BriefingSection, ChatMessage, IntelItem } from "@/types/intel";
import {
  cacheGet,
  cacheSet,
  TTL,
  itemSummaryKey,
  briefingKey,
  hashKey,
} from "@/lib/intel/cache";

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL;
const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

function getClient() {
  if (!apiKey) {
    return null;
  }

  return new OpenAI({
    apiKey,
    baseURL,
  });
}

export function isLlmConfigured() {
  return Boolean(apiKey);
}

export function getLlmSettings() {
  return {
    configured: isLlmConfigured(),
    model,
    baseURL,
  };
}

function fallbackBriefing(items: IntelItem[]): BriefingSection[] {
  const top = items.slice(0, 3);

  return [
    {
      heading: "今日概览",
      body: `当前优先级最高的信号集中在 ${top.map((item) => item.tags[0] ?? item.sourceName).join("、")}，核心关注点是采集频率、采购落地和应急响应时效。`,
    },
    {
      heading: "发生了什么",
      body: top.map((item) => `${item.title}：${item.summary}`).join(" "),
    },
    {
      heading: "建议动作",
      body: "优先校验高频信号来源，检查跨源重复，并让 Ask AI 提炼对采集排期、项目采购和灾害响应的具体影响。",
    },
  ];
}

export async function enrichItemSummary(item: IntelItem): Promise<IntelItem> {
  const client = getClient();
  if (!client) return item;

  // Check cache first — item content is stable so 7-day TTL is safe.
  const key = itemSummaryKey(item.title, item.url, item.body);
  const cached = cacheGet<{ summary: string; whyItMatters: string }>(key);
  if (cached) {
    return { ...item, summary: cached.summary, whyItMatters: cached.whyItMatters };
  }

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content:
            "你是卫星与遥感行业资讯压缩助手。必须只输出中文，禁止出现英文单词（专有名词缩写如 SAR、RGB、EO 除外）。" +
            "严格按以下格式返回两行，不得添加额外文字：\n" +
            "SUMMARY: <一句话中文摘要，不超过50字>\n" +
            "WHY: <一句话说明为何值得关注，不超过40字>",
        },
        {
          role: "user",
          content: `标题: ${item.title}\n来源: ${item.sourceName}\n标签: ${item.tags.join("、")}\n正文: ${item.body}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const summary = content.match(/SUMMARY:\s*(.+)/i)?.[1]?.trim();
    const why = content.match(/WHY:\s*(.+)/i)?.[1]?.trim();

    const result = {
      ...item,
      summary: summary || item.summary,
      whyItMatters: why || item.whyItMatters,
    };
    // Persist to SQLite so identical items don't trigger another LLM call.
    cacheSet(key, { summary: result.summary, whyItMatters: result.whyItMatters }, TTL.ITEM_SUMMARY);
    return result;
  } catch {
    return item;
  }
}

export async function generateBriefing(items: IntelItem[]): Promise<BriefingSection[]> {
  const client = getClient();
  if (!client) return fallbackBriefing(items);

  // Cache briefings for 6 hours keyed by the top-6 item fingerprint.
  const key = briefingKey(items);
  const cached = cacheGet<BriefingSection[]>(key);
  if (cached) return cached;

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 380,
      messages: [
        {
          role: "system",
          content:
            "你是卫星情报简报生成助手。所有输出必须是中文（专有名词缩写如 SAR、RGB、GEO 除外）。" +
            "严格返回三段，每段格式为：SECTION: 标题 :: 正文内容。不得偏离此格式，不得输出英文句子。",
        },
        {
          role: "user",
          content: items
            .slice(0, 6)
            .map(
              (item, index) =>
                `${index + 1}. 标题：${item.title}\n来源：${item.sourceName}\n标签：${item.tags.join("、")}\n摘要：${item.summary}\n评分：${item.compositeScore}`,
            )
            .join("\n\n"),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const sections = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("SECTION:"))
      .map((line) => {
        const payload = line.replace("SECTION:", "").trim();
        const [heading, body] = payload.split("::").map((entry) => entry.trim());
        return {
          heading: heading || "简报",
          body: body || "模型未返回内容。",
        };
      });

    const result = sections.length ? sections : fallbackBriefing(items);
    cacheSet(key, result, TTL.BRIEFING);
    return result;
  } catch {
    return fallbackBriefing(items);
  }
}

export async function generateChatAnswer(params: {
  messages: ChatMessage[];
  contextItems: IntelItem[];
  missionContext?: string;
}) {
  const { messages, contextItems, missionContext } = params;
  const client = getClient();
  const contextBlock = contextItems
    .slice(0, 5)
    .map(
      (item, index) =>
        `Signal ${index + 1}: ${item.title}\nSource: ${item.sourceName}\nPublished: ${item.publishedAt}\nTags: ${item.tags.join(", ")}\nSummary: ${item.summary}\nWhy: ${item.whyItMatters}`,
    )
    .join("\n\n");

  if (!client) {
    const latestQuestion = messages.at(-1)?.content ?? "";
    const topTitles = contextItems.slice(0, 2).map((item) => item.title).join("、");
    return `（演示模式，未接入 LLM）当前资讯参考：${topTitles}。关于”${latestQuestion}”，建议重点关注采集节奏、采购落地和应急工作流这三个方向。`;
  }

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 420,
    messages: [
      {
        role: "system",
        content:
          "你是卫星情报协作助手。所有回答必须用中文（专有名词缩写如 SAR、RGB、EO、GEO、LEO 可以保留）。" +
          "尽量只基于给定资讯回答，证据不足时明确说明不确定性。在适合时指出 RGB、SAR、MS 哪种模态能帮助后续判断。",
      },
      {
        role: "system",
        content: `任务背景：${missionContext || "通用卫星市场监测"}\n\n参考资讯：\n${contextBlock}`,
      },
      ...messages,
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "No answer returned.";
}

/* ── Title translation ─────────────────────────────────────────────── */

const CJK_RE = /[一-鿿㐀-䶿]/;
/** True when the string already has enough Chinese characters (>20% of letters). */
function isMostlyChinese(s: string): boolean {
  const letters = s.replace(/\s/g, "");
  if (!letters) return false;
  const cjk = [...letters].filter((c) => CJK_RE.test(c)).length;
  return cjk / letters.length > 0.2;
}

/**
 * Translate an article title to Chinese, or return it unchanged if already
 * mostly Chinese.  Result is cached for 30 days by title hash.
 *
 * Falls back to the original title when no LLM is configured.
 */
export async function translateTitle(title: string, bodyPreview = ""): Promise<string> {
  if (isMostlyChinese(title)) return title;
  const client = getClient();
  if (!client) return title;

  const key = hashKey(`title:${title}:${bodyPreview.slice(0, 80)}`);
  const cached = cacheGet<string>(key);
  if (cached) return cached;

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.1,
      max_tokens: 60,
      messages: [
        {
          role: "system",
          content:
            "你是卫星遥感行业标题翻译助手。将英文标题译为简洁的中文标题（20字以内）。" +
            "保留 SAR、RGB、EO、GEO、LEO、NASA 等专有名词缩写。只输出中文标题本身，不加引号或解释。",
        },
        {
          role: "user",
          content: bodyPreview
            ? `标题：${title}\n正文摘要：${bodyPreview.slice(0, 120)}`
            : `标题：${title}`,
        },
      ],
    });
    const translated = completion.choices[0]?.message?.content?.trim() ?? title;
    const result = translated || title;
    cacheSet(key, result, TTL.TITLE);
    return result;
  } catch {
    return title;
  }
}

/* ── AI-generated articles batch ───────────────────────────────────── */

export type AiArticleRaw = {
  title: string;
  body: string;
  tags: string[];
  region: string;
  imageryModes: Array<"RGB" | "SAR" | "MS">;
};

/**
 * Ask the LLM to generate a batch of plausible satellite-industry news items.
 * Used by the AI crawler adapter to supplement sparse RSS feeds.
 * Result is cached for 2 hours to avoid hammering the LLM on every reload.
 */
export async function generateAiArticles(count = 6): Promise<AiArticleRaw[]> {
  const client = getClient();
  if (!client) return [];

  const cacheKey = hashKey(`ai-articles:${count}:${new Date().toISOString().slice(0, 13)}`);
  const cached = cacheGet<AiArticleRaw[]>(cacheKey);
  if (cached) return cached;

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是卫星遥感行业分析师。生成 " + count + " 条真实感强的行业资讯（中文），" +
            "覆盖 SAR 星座、光学成像、卫星发射、政务采购、应急响应、轨道技术等主题。" +
            "以 JSON 格式返回，结构为：{\"articles\":[{\"title\":\"...\",\"body\":\"...(150字以内)\",\"tags\":[...],\"region\":\"...\",\"imageryModes\":[...]}]}\n" +
            "imageryModes 只能包含 RGB、SAR、MS 中的一个或多个。region 使用中文地区名。",
        },
        {
          role: "user",
          content: `请生成 ${count} 条今日卫星遥感行业简讯，涵盖不同地区和技术方向。`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { articles?: AiArticleRaw[] };
    const articles = parsed.articles ?? [];
    if (articles.length) cacheSet(cacheKey, articles, TTL.AI_ARTICLES);
    return articles;
  } catch {
    return [];
  }
}
