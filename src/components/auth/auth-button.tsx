"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";

type Props = { userId: string | null; userName?: string | null };

export function AuthButton({ userId, userName }: Props) {
  if (userId) {
    const display = userName
      ? userName.length > 10 ? userName.slice(0, 10) + "…" : userName
      : "我的账号";

    return (
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/news" })}
        className="flex items-center gap-1.5 rounded-full border border-[#c8d0e0] bg-[#f4f7ff] px-3 py-2 text-xs font-medium text-[#2a55cc] hover:bg-[#e8f0ff] hover:border-[#3d74ff] transition"
        title="点击退出登录"
      >
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1a2540] text-[10px] font-bold text-white">
          {display[0]?.toUpperCase() ?? "U"}
        </span>
        {display}
        <span className="text-[#93b4f0]">· 退出</span>
      </button>
    );
  }

  return (
    <Link
      href="/signin"
      className="flex items-center gap-1.5 rounded-full border border-[#c8d0e0] bg-white px-3 py-2 text-xs font-medium text-[#1a2540] hover:border-[#3d74ff] hover:text-[#2a55cc] hover:bg-[#f4f7ff] transition"
    >
      登录
    </Link>
  );
}
