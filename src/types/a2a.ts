export type A2ATaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "unknown";

export type A2AAgentStatus = "ready" | "working" | "waiting" | "completed";

export type A2AAgentCard = {
  id: string;
  name: string;
  role: "host" | "remote" | "observer";
  endpoint: string;
  version: string;
  status: A2AAgentStatus;
  trustBoundary: string;
  skills: string[];
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    modalities: string[];
  };
};

export type A2AWorkflowEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  transport: "JSON-RPC" | "SSE" | "REST";
  state: "active" | "complete" | "queued";
};

export type A2AWorkflowStep = {
  id: string;
  agentId: string;
  title: string;
  subtitle: string;
  taskState: A2ATaskState;
  latencyMs: number;
  artifactCount: number;
};

export type A2AEvent = {
  id: string;
  timestamp: string;
  agentId: string;
  eventType: "agent-card" | "send-message" | "status-update" | "artifact-update" | "task-get";
  title: string;
  detail: string;
  state: A2ATaskState;
  payload: Record<string, unknown>;
};

export type A2AArtifact = {
  id: string;
  ownerAgentId: string;
  title: string;
  kind: "brief" | "evidence-table" | "risk-register" | "operator-plan";
  status: "draft" | "verified" | "merged";
  summary: string;
  parts: string[];
};

export type A2AOrchestrationRun = {
  id: string;
  sessionId: string;
  goal: string;
  updatedAt: string;
  taskState: A2ATaskState;
  statusMessage: string;
  agents: A2AAgentCard[];
  workflow: A2AWorkflowStep[];
  edges: A2AWorkflowEdge[];
  events: A2AEvent[];
  artifacts: A2AArtifact[];
  finalResult: {
    title: string;
    summary: string;
    decisions: string[];
    nextActions: string[];
  };
  metrics: {
    activeAgents: number;
    taskUpdates: number;
    artifacts: number;
    meanLatencyMs: number;
  };
};
