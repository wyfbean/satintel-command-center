import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getDashboardData } from "@/lib/intel/service";

export default async function Home() {
  const data = await getDashboardData();

  return <DashboardShell initialData={data} />;
}
