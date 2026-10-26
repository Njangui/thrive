/**
 * Adaptateur `AgentRuntimePort` (canaux) au-dessus du noyau agentique (C1).
 * Les canaux n'envoient qu'un message d'un acteur authentifié ; ils reçoivent du texte, des cartes d'approbation et un
 * statut. Les cartes sont rédigées par le CODE (aperçu de l'outil, sinon paramètres expurgés), jamais par le modèle.
 */
import type { Actor, ToolDef } from "@/application/agents/contracts";
import type { AgentRuntime } from "@/application/agents/runtime";
import { isToolExposed } from "@/application/agents/runtime";
import { defaultAgentSettings } from "@/application/agents/settings";
import type { AgentActor } from "@/application/channels/actor";
import { computeActionFingerprint } from "@/application/channels/action-fingerprint";
import { ASSISTANT_AGENT_NAME } from "@/application/agents/domains/assistant";
import type {
  AgentEvent, AgentRunInput, AgentRuntimePort, ApprovalCard, ApprovalDecision, ApprovalOutcome, VisibleTool,
} from "@/domain/ports/agent-runtime-port";
import type { StepUpMethod, StepUpPort } from "@/domain/ports/step-up-port";
import type { createStepUpBridge } from "./step-up-bridge";

type Runtime = Pick<AgentRuntime, "runAgent" | "approve" | "execute" | "reject" | "registry" | "pending" | "settings" | "matrix">;

export interface KernelRuntimeDeps {
  runtime: Runtime;
  stepUp: Pick<StepUpPort, "createChallenge">;
  bridge: Pick<ReturnType<typeof createStepUpBridge>, "remember">;
  agentName?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "Trop de demandes en peu de temps : réessayez dans un instant.",
  budget_exceeded: "Les crédits IA de l'entreprise sont épuisés.",
  actor_required: "Identité non reconnue : action refusée.",
};

const REFUSALS: Record<string, string> = {
  expired: "Cette action a expiré : redemandez-la.",
  not_pending: "Cette action n'est plus en attente (déjà traitée).",
  not_found: "Action introuvable.",
  not_authorized: "Vos droits ne permettent pas de valider cette action.",
  self_approval_forbidden: "Une autre personne habilitée doit valider cette action (vous ne pouvez pas valider votre propre demande).",
  step_up_required: "La validation renforcée (PIN) est requise et n'a pas pu être vérifiée.",
  params_changed: "Les paramètres ont changé : redemandez l'action.",
};

export function toKernelActor(actor: AgentActor): Actor {
  return { userId: actor.userId, tenantId: actor.tenantId, membershipId: actor.membershipId, role: actor.role, extraPermissions: actor.extraPermissions, channel: actor.channel };
}

/** Méthodes de validation renforcée : le bouton Telegram seul ne suffit jamais pour un remboursement. */
export function allowedMethodsFor(toolName: string, channel: Actor["channel"]): StepUpMethod[] {
  const methods: StepUpMethod[] = ["pin", "dashboard_link"];
  if (channel === "telegram" && toolName !== "orders.refund") methods.push("telegram_button");
  return methods;
}

export class KernelAgentRuntime implements AgentRuntimePort {
  readonly name = "kernel";
  constructor(private readonly deps: KernelRuntimeDeps) {}

  private get agentName() { return this.deps.agentName ?? ASSISTANT_AGENT_NAME; }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const actor = toKernelActor(input.actor);
    let result;
    try {
      result = await this.deps.runtime.runAgent({
        actor,
        agentName: this.agentName,
        message: input.text,
        history: input.history.map((m) => ({ role: m.role, content: m.content })),
      });
    } catch (error) {
      console.error("[agents] exécution impossible:", error instanceof Error ? error.message : error);
      yield { type: "error", code: "internal", message: "L'assistant a rencontré une erreur. Réessayez." };
      return;
    }
    if (result.status === "blocked" || result.status === "failed") {
      const code = result.errorCode === "rate_limited" ? "rate_limited" : result.errorCode === "budget_exceeded" ? "budget_exceeded" : "internal";
      yield { type: "error", code, message: ERROR_MESSAGES[result.errorCode ?? ""] ?? "L'assistant n'a pas pu traiter cette demande." };
      return;
    }
    if (result.text) yield { type: "text_delta", text: result.text };
    for (const pending of result.pendingApprovals) {
      const card = await this.buildCard(actor, pending.pendingActionId, pending.toolName);
      if (card) yield { type: "approval_required", card };
    }
    yield { type: "done", runId: result.runId };
  }

  /**
   * Exécution d'une tâche planifiée : même chemin que le chat, mais les cartes sont construites comme pour le tableau de bord
   * (validation renforcée possible) puisqu'elles sont livrées dans un fil du chat.
   */
  async runScheduled(input: { actor: Actor; agentName: string; message: string }) {
    const result = await this.deps.runtime.runAgent({ actor: input.actor, agentName: input.agentName, message: input.message });
    const cards: ApprovalCard[] = [];
    const cardActor: Actor = { ...input.actor, channel: "dashboard" };
    for (const p of result.pendingApprovals) {
      try {
        const card = await this.buildCard(cardActor, p.pendingActionId, p.toolName);
        if (card) cards.push(card);
      } catch (error) {
        console.error("[agents] carte de tâche planifiée impossible:", error instanceof Error ? error.message : error);
      }
    }
    return { ...result, cards };
  }

  private async buildCard(actor: Actor, pendingActionId: string, toolName: string): Promise<ApprovalCard | null> {
    const { registry, pending } = this.deps.runtime;
    const tool = registry.get(toolName);
    const row = await pending.get(actor.tenantId, pendingActionId);
    if (!tool || !row || tool.risk === "read") return null;
    let title = tool.description.split(".")[0] ?? toolName;
    let summary = "Confirmez pour exécuter cette action.";
    let details = Object.entries(row.paramsPreview ?? {}).slice(0, 8).map(([label, value]) => ({ label, value: typeof value === "string" ? value : JSON.stringify(value) }));
    if (tool.preview) {
      try {
        const p = await tool.preview({ actor }, row.params);
        title = p.title; summary = p.summary; details = p.details;
      } catch {
        // aperçu indisponible : on garde la version générique (paramètres expurgés)
      }
    }
    const card: ApprovalCard = { pendingActionId, tool: toolName, title, summary, risk: tool.risk, details, expiresAt: row.expiresAt };
    if (tool.risk === "sensitive" && actor.membershipId && actor.channel !== "scheduler" && actor.channel !== "customer") {
      const allowedMethods = allowedMethodsFor(toolName, actor.channel);
      const challenge = await this.deps.stepUp.createChallenge({
        organizationId: actor.tenantId,
        membershipId: actor.membershipId,
        channel: actor.channel,
        purpose: toolName.slice(0, 64),
        actionFingerprint: computeActionFingerprint(toolName, row.params),
        allowedMethods,
        pendingActionId,
      });
      card.stepUp = { challengeId: challenge.challengeId, allowedMethods: challenge.allowedMethods, linkToken: challenge.linkToken };
    }
    return card;
  }

  async decideApproval(input: { actor: AgentActor; pendingActionId: string } & ApprovalDecision): Promise<ApprovalOutcome> {
    const { runtime } = this.deps;
    const actor = toKernelActor(input.actor);
    const row = await runtime.pending.get(actor.tenantId, input.pendingActionId);
    if (!row) return { status: "failed", message: REFUSALS.not_found! };
    if (input.decision === "reject") {
      const ok = await runtime.reject(actor, input.pendingActionId);
      return ok ? { status: "rejected", message: "Action refusée, rien n'a été modifié." } : { status: "failed", message: REFUSALS.not_pending! };
    }
    if (input.decision === "edit") {
      return { status: "failed", message: "La modification d'une action n'est pas encore disponible : refusez-la puis redemandez-la avec les bonnes valeurs." };
    }
    if (input.stepUp?.challengeId) this.deps.bridge.remember(input.pendingActionId, input.stepUp.challengeId);
    const approved = await runtime.approve(actor, { toolName: row.toolName, pendingActionId: input.pendingActionId, expectedHash: row.paramsHash });
    if (!approved.ok) {
      const message = REFUSALS[approved.reason] ?? "Validation refusée.";
      return { status: approved.reason === "expired" ? "expired" : "failed", message };
    }
    const outcome = await runtime.execute(actor, { toolName: row.toolName, pendingActionId: input.pendingActionId, runId: crypto.randomUUID() });
    if (outcome.status === "ok") return { status: "executed", message: "Action exécutée." };
    if (outcome.status === "denied") return { status: "failed", message: REFUSALS[outcome.reason] ?? "Action refusée par les règles de sécurité." };
    if (outcome.status === "pending_confirmation") return { status: "failed", message: "Une confirmation supplémentaire est requise." };
    return { status: "failed", message: "L'action a échoué : aucune modification confirmée." };
  }

  async listVisibleTools(input: AgentActor): Promise<VisibleTool[]> {
    const { registry, settings, matrix } = this.deps.runtime;
    const actor = toKernelActor(input);
    const current = (await settings.get(actor.tenantId)) ?? defaultAgentSettings(actor.tenantId);
    return registry.list()
      .filter((tool: ToolDef<unknown, unknown>) => isToolExposed({ actor, tool, settings: current, matrix }))
      .map((tool) => ({ name: tool.name, label: tool.description.split(".")[0] ?? tool.name, domain: tool.domain, risk: tool.risk }));
  }
}
