/** Traçage des exécutions d'agents (tables `agent_runs` / `agent_steps`, migration 0103). */
import type { Channel, ModelTier } from "./contracts";

export type RunStatus =
  | "running"
  | "completed"
  | "awaiting_approval"
  | "failed"
  | "budget_exceeded"
  | "max_steps"
  | "blocked";

export interface RunRecord {
  id: string;
  tenantId: string;
  agentName: string;
  promptVersion: string;
  actorUserId: string;
  channel: Channel;
  parentRunId?: string;
  depth: number;
  modelTier: ModelTier;
}

export interface StepRecord {
  runId: string;
  tenantId: string;
  stepIndex: number;
  kind: "llm" | "tool";
  toolName?: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  inputTokens: number;
  outputTokens: number;
  units: number;
  status: "ok" | "error" | "denied" | "pending_confirmation";
  errorCode?: string;
  durationMs: number;
  /** Expurgé : jamais de contenu de message ni de sortie d'outil. */
  detail: Record<string, unknown>;
}

export interface RunFinish {
  status: Exclude<RunStatus, "running">;
  stepsCount: number;
  unitsUsed: number;
  inputTokens: number;
  outputTokens: number;
  errorCode?: string;
}

export interface RunStore {
  createRun(run: RunRecord): Promise<void>;
  addStep(step: StepRecord): Promise<void>;
  finishRun(runId: string, tenantId: string, finish: RunFinish): Promise<void>;
}
