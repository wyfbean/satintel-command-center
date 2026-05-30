import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { NextRequest } from "next/server";

import { SatelliteDashboardAgent } from "@/lib/a2a/dashboard-agent";

/**
 * CopilotKit runtime endpoint shared by the AG-UI surfaces.
 *
 * - `satelliteAnalyst` bridges to the Python CrewAI backend over AG-UI via `HttpAgent`
 *   (POST /agent). This is the official CopilotKit↔CrewAI pattern; the crew's multi-agent
 *   collaboration and MCP/A2A tool-call results stream into the `/orchestration` chat.
 * - `satellite_dashboard` stays in-process for `/dashboard`.
 *
 * `ExperimentalEmptyAdapter` is the documented adapter when agents emit their own events,
 * so no LLM key is needed at the runtime level (the CrewAI backend handles its own LLM /
 * mock fallback).
 */
const runtime = new CopilotRuntime({
  agents: {
    satelliteAnalyst: new HttpAgent({
      url: process.env.AGENT_BACKEND_URL ?? "http://127.0.0.1:8000/agent",
    }),
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
