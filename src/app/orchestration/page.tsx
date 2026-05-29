import { OrchestrationShell } from "@/components/orchestration/orchestration-shell";
import { mockA2AOrchestrationRun } from "@/lib/mock/a2a-orchestration";

export default function OrchestrationPage() {
  return <OrchestrationShell run={mockA2AOrchestrationRun} />;
}
