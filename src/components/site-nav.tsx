"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SiteNavProps = {
  /** "light" for the white pages, "dark" for the globe page. */
  variant?: "light" | "dark";
};

const links = [
  { href: "/news", label: "首页" },
  { href: "/orchestration", label: "智能体分析" },
  { href: "/globe", label: "3D 星图" },
];

export function SiteNav({ variant = "light" }: SiteNavProps) {
  const pathname = usePathname();
  const isDark = variant === "dark";

  const base = isDark
    ? "border-white/25 text-slate-200 hover:bg-white/10 hover:text-white"
    : "border-[#c8d0e0] bg-white text-[#1a2540] hover:border-[#3d74ff] hover:text-[#2a55cc] hover:bg-[#f4f7ff]";
  const active = isDark
    ? "bg-white text-[#05070f] border-transparent"
    : "bg-[#1a2540] text-white border-transparent shadow-[0_2px_8px_rgba(26,37,64,0.18)]";

  return (
    <nav className="flex flex-wrap items-center gap-2 text-sm">
      {links.map((link) => {
        const isActive = pathname === link.href || (link.href !== "/news" && pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-full border px-4 py-2 font-medium transition ${isActive ? active : base}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
