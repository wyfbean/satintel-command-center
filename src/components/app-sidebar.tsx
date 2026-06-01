"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/news",         label: "资讯流",   icon: <NewsIcon /> },
  { href: "/orchestration",label: "智能体",   icon: <AgentIcon /> },
  { href: "/dashboard",    label: "数据面板", icon: <DashIcon /> },
  { href: "/globe",        label: "3D 星图",  icon: <GlobeIcon /> },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-14 flex-none flex-col items-center gap-1 bg-[#1a1f2e] py-4">
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-[#3d74ff]">
        <span className="text-xs font-bold text-white">SI</span>
      </div>
      <nav className="flex flex-col items-center gap-1">
        {NAV.map(({ href, label, icon }) => {
          const active = pathname === href || (href !== "/news" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${
                active
                  ? "bg-[#3d74ff] text-white"
                  : "text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              {icon}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/* ── icons ───────────────────────────────────────────────────────── */

function NewsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M4 10h16M4 14h10M4 18h8" />
    </svg>
  );
}
function AgentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M6 20v-1a6 6 0 0 1 12 0v1" />
      <circle cx="18" cy="7" r="2" />
      <path d="M18 9v4" />
    </svg>
  );
}
function DashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6M9 12h6M9 15h4" />
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
