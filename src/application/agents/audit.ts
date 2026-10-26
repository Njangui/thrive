/** Journal d'audit des agents (table append-only `agent_audit_events`, migration 0102). */
import type { Channel, RiskLevel } from "./contracts";

export type AuditEventKind =
  | "decision"
  | "approval_requested"
  | "approved"
  | "rejected"
  | "expired"
  | "executed"
  | "failed";

export interface AuditEvent {
  tenantId: string;
  actorUserId?: string;
  channel: Channel;
  runId?: string;
  toolName: string;
  risk: RiskLevel;
  event: AuditEventKind;
  decision?: "allow" | "confirm" | "deny";
  reason?: string;
  /** Déjà expurgés (`redactParams`) : le puits n'écrit jamais de paramètres bruts. */
  paramsRedacted: unknown;
  pendingActionId?: string;
  cost?: unknown;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}
