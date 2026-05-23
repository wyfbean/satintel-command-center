"use client";

import { startTransition, useState } from "react";

import type { ChatMessage, IntelItem } from "@/types/intel";

type ChatPanelProps = {
  selectedItems: IntelItem[];
};

export function ChatPanel({ selectedItems }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你可以围绕当前选中的新闻继续追问，例如“这条新闻会影响哪些采购决策？”或“下一步应该补哪种模态数据？”",
    },
  ]);
  const [question, setQuestion] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function submitQuestion() {
    if (!question.trim()) {
      return;
    }

    const nextUserMessage: ChatMessage = {
      role: "user",
      content: question.trim(),
    };

    const nextMessages = [...messages, nextUserMessage];
    setMessages(nextMessages);
    setQuestion("");
    setIsPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages,
          selectedIds: selectedItems.map((item) => item.id),
          missionContext: "卫星、遥感与行业资讯监测",
        }),
      });

      const payload = (await response.json()) as { answer?: string };

      startTransition(() => {
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: payload.answer || "暂时没有返回内容。",
          },
        ]);
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <section className="rounded-[28px] border border-[#ebeef3] bg-white p-5 shadow-[0_12px_28px_rgba(28,42,71,0.06)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#3d74ff]">Ask AI about this news</div>
          <h3 className="mt-2 text-2xl font-semibold text-slate-900">围绕当前新闻追问</h3>
        </div>
        <div className="rounded-full bg-[#eefbf1] px-3 py-1 text-xs text-[#15803d]">上下文 {selectedItems.length} 条</div>
      </div>

      <div className="mt-4 space-y-3">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`rounded-[22px] px-4 py-3 text-sm leading-7 ${
              message.role === "assistant" ? "bg-[#f7f8fb] text-slate-700" : "bg-[#eef4ff] text-slate-900"
            }`}
          >
            {message.content}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-[24px] border border-[#ebeef3] bg-[#fbfbfc] p-3">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="例如：这条新闻对政府采购、星座部署或灾害监测意味着什么？"
          className="min-h-28 w-full resize-none bg-transparent text-sm leading-7 text-slate-800 outline-none placeholder:text-slate-400"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-400">系统会优先结合当前选中新闻与相近信号作答</div>
          <button
            type="button"
            onClick={() => void submitQuestion()}
            disabled={isPending}
            className="rounded-full bg-[#1f2430] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#111827] disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isPending ? "生成中..." : "发送"}
          </button>
        </div>
      </div>
    </section>
  );
}
