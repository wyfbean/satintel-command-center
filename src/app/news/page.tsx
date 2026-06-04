import { HomeShell } from "@/components/home/home-shell";
import { getDashboardData } from "@/lib/intel/service";
import { ensureScheduler } from "@/lib/intel/scheduler";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  ensureScheduler();
  const [data, session] = await Promise.all([getDashboardData(), auth()]);
  const userId   = session?.user?.id   ?? null;
  const userName = session?.user?.name ?? null;
  return <HomeShell initialData={data} userId={userId} userName={userName} />;
}
