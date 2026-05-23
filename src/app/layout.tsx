import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "卫星情报资讯流",
  description: "面向卫星、遥感与微信行业信号的中文资讯流与 Ask AI 协作工作台。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
