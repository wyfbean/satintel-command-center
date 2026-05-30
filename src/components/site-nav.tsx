"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SiteNavProps = {
  /** "light" for the white pages, "dark" for the globe page. */
  variant?: "light" | "dark";
};

const links = [
  { href: "/", label: "资讯流" },
  { href: "/orchestration", label: "智能体分析" },
  { href: "/dashboard", label: "数据面板" },
  { href: "/globe", label: "3D 星图" },
];

export function SiteNav({ variant = "light" }: SiteNavProps) {
  const pathname = usePathname();
  const isDark = variant === "dark";

  const base = isDark
    ? "border-white/15 text-slate-300 hover:bg-white/5"
    : "border-[#e8ebf0] bg-white text-slate-600 hover:border-[#cfdcff]";
  const active = isDark ? "bg-white text-[#05070f]" : "bg-[#1f2430] text-white border-transparent";

  return (
    <nav className="flex flex-wrap items-center gap-2 text-sm">
      {links.map((link) => {
        const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
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
