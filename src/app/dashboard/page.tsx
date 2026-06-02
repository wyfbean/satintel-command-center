import { redirect } from "next/navigation";

// 数据面板已并入首页 /news（顶部「今日趋势」面板）。保留路由作重定向。
export default function DashboardPage() {
  redirect("/news");
}
