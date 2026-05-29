import { OrchestrationShell } from "@/components/orchestration/orchestration-shell";

// Interactive CopilotKit/AG-UI page; render on demand rather than prerender.
export const dynamic = "force-dynamic";

export default function OrchestrationPage() {
  return <OrchestrationShell />;
}
