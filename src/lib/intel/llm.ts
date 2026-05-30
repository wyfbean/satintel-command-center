import OpenAI from "openai";

import type { BriefingSection, ChatMessage, IntelItem } from "@/types/intel";
import {
  cacheGet,
  cacheSet,
  TTL,
  itemSummaryKey,
  briefingKey,
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
            "你负责把卫星与遥感资讯压缩成中文简报。返回两行。第 1 行以 SUMMARY: 开头，第 2 行以 WHY: 开头。",
        },
        {
          role: "user",
          content: `Title: ${item.title}\nSource: ${item.sourceName}\nTags: ${item.tags.join(", ")}\nBody: ${item.body}`,
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
            "你负责生成中文卫星情报简报。严格返回三段，每段格式为：SECTION: heading :: body",
        },
        {
          role: "user",
          content: items
            .slice(0, 6)
            .map(
              (item, index) =>
                `${index + 1}. ${item.title}\nSource: ${item.sourceName}\nTags: ${item.tags.join(", ")}\nSummary: ${item.summary}\nScore: ${item.compositeScore}`,
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
    return `Grounded answer based on the current feed: ${contextItems
      .slice(0, 2)
      .map((item) => item.title)
      .join(" | ")}。关于“${latestQuestion}”，当前最值得继续深挖的是采集节奏、采购落地和应急工作流这三条线。`;
  }

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 420,
    messages: [
      {
        role: "system",
        content:
          "你是卫星情报协作助手。尽量只基于给定资讯回答，证据不足时明确说明不确定性。回答使用中文，并在适合时指出 RGB、SAR、MS 哪种模态能帮助后续判断。",
      },
      {
        role: "system",
        content: `Mission context: ${missionContext || "通用卫星市场监测"}\n\nSignal context:\n${contextBlock}`,
      },
      ...messages,
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "No answer returned.";
}
