import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest } from "next/server";

import { OrchestrationMockAgent } from "@/lib/a2a/orchestration-agent";
import { SatelliteDashboardAgent } from "@/lib/a2a/dashboard-agent";

/**
 * CopilotKit runtime endpoint shared by the AG-UI surfaces.
 *
 * Agents are registered as in-process AG-UI `AbstractAgent`s, so no external LLM
 * service adapter is required — `ExperimentalEmptyAdapter` is the documented choice
 * when the agents emit their own events. This keeps the zero-env-var invariant: the
 * orchestration replay needs no key. Live-LLM grounding is delegated to the agents
 * themselves (which reuse src/lib/intel/llm.ts and its deterministic fallback).
 */
const runtime = new CopilotRuntime({
  agents: {
    orchestration: new OrchestrationMockAgent(),
    satellite_dashboard: new SatelliteDashboardAgent(),
  },
});

const serviceAdapter = new ExperimentalEmptyAdapter();

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
