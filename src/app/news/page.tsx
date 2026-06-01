import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getDashboardData } from "@/lib/intel/service";
import { ensureScheduler } from "@/lib/intel/scheduler";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  ensureScheduler();
  const data = await getDashboardData();
  return <DashboardShell initialData={data} />;
}
