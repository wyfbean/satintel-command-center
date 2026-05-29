import { DashboardCopilotShell } from "@/components/dashboard-copilot/dashboard-copilot-shell";

// Interactive CopilotKit/AG-UI page; render on demand rather than prerender.
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return <DashboardCopilotShell />;
}
