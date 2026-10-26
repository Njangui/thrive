import type { AgentActor } from "@/application/channels/actor";
import type { StepUpMethod } from "./step-up-port";

/**
 * AgentRuntimePort — frontière canaux (C2) ↔ runtime agentique (C1).
 * Les canaux n'ont aucune connaissance des prompts, outils ou modèles : ils
 * envoient un message authentifié (acteur résolu) et reçoivent des événements.
 *
 * ALIGNEMENT C1 : forme provisoire, à remplacer par `contracts.ts`. Tant que C1
 * n'a pas livré, l'adaptateur par défaut est `UnavailableAgentRuntime`.
 *
 * Sécurité (principes 5 et 6) : `text` et `attachments` sont des DONNÉES de
 * l'utilisateur authentifié ; tout contenu cité (message client transféré,
 * page web, document) reste une donnée, jamais une instruction.
 */
export type ToolRisk = "read" | "write_reversible" | "sensitive";

export interface AgentAttachment {
  kind: "image" | "audio" | "document";
  /** Chemin de stockage relatif au tenant (jamais une URL fournie par le client). */
  path: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface ApprovalCard {
  pendingActionId: string;
  tool: string;
  title: string;
  /** Résumé lisible, rédigé par le code (pas le LLM) pour les montants. */
  summary: string;
  risk: Exclude<ToolRisk, "read">;
  details: { label: string; value: string }[];
  editableFields?: { name: string; label: string; type: "text" | "number"; value: string }[];
  expiresAt: string;
  /** Présent quand le moteur de règles exige une authentification renforcée. */
  stepUp?: { challengeId: string; allowedMethods: StepUpMethod[]; linkToken?: string };
}

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_status"; callId: string; tool: string; label: string; risk: ToolRisk; status: "running" | "done" | "failed" }
  | { type: "approval_required"; card: ApprovalCard }
  | { type: "done"; runId?: string }
  | { type: "error"; code: "unavailable" | "rate_limited" | "budget_exceeded" | "internal"; message: string };

export interface AgentRunInput {
  actor: AgentActor;
  threadId: string;
  text: string;
  attachments: AgentAttachment[];
  history: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
}

export type ApprovalDecision =
  | { decision: "approve"; stepUp?: { challengeId: string } }
  | { decision: "reject" }
  | { decision: "edit"; edits: Record<string, string> };

export type ApprovalOutcome =
  | { status: "executed"; message: string }
  | { status: "rejected"; message: string }
  | { status: "expired"; message: string }
  | { status: "failed"; message: string }
  /** « Modifier » : l'empreinte change, C1 émet une NOUVELLE carte à valider. */
  | { status: "replaced"; message: string; card: ApprovalCard };

export interface VisibleTool { name: string; label: string; domain: string; risk: ToolRisk }

export interface AgentRuntimePort {
  readonly name: string;
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
  decideApproval(input: { actor: AgentActor; pendingActionId: string } & ApprovalDecision): Promise<ApprovalOutcome>;
  /** Outils visibles pour CET acteur (rôle + réglages du propriétaire). */
  listVisibleTools(actor: AgentActor): Promise<VisibleTool[]>;
}
