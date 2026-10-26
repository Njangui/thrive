/**
 * Point d'entrée UNIQUE d'exécution d'un outil. Tout passe par ici :
 * acteur valide -> entrée validée -> décision du moteur -> audit -> exécution
 * -> sortie validée -> audit. Aucun outil n'est appelable autrement.
 */
import type { Actor, EvaluateAction, TenantScopedDb, ToolDef, UsageService } from "./contracts";
import { assertActor } from "./actor";
import { redactParams } from "./canonical";
import type { AuditEvent, AuditSink } from "./audit";
import { AgentError, type AgentErrorCode } from "./errors";
import type { PendingActionService, ApprovalFailure } from "./pending-actions";
import type { ToolRegistryImpl } from "./tool-registry";

export interface RuntimeDeps {
  registry: ToolRegistryImpl;
  evaluate: EvaluateAction;
  pending: PendingActionService;
  audit: AuditSink;
  usage: UsageService;
  makeDb: (tenantId: string) => TenantScopedDb;
}

export type ToolOutcome =
  | { status: "ok"; output: unknown }
  | { status: "pending_confirmation"; pendingActionId: string; reason: string }
  | { status: "denied"; reason: string }
  | { status: "error"; code: AgentErrorCode };

type AnyTool = ToolDef<unknown, unknown>;

async function writeAudit(deps: RuntimeDeps, event: AuditEvent, mustSucceed: boolean): Promise<void> {
  try {
    await deps.audit.record(event);
  } catch (error) {
    console.error("[agents] échec d'écriture du journal d'audit:", error instanceof Error ? error.message : error);
    if (mustSucceed) throw new AgentError("audit_unavailable", "Journal d'audit indisponible : action refusée");
  }
}

function baseEvent(actor: Actor, tool: Pick<AnyTool, "name" | "risk">, runId: string | undefined, params: unknown) {
  return {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    channel: actor.channel,
    runId,
    toolName: tool.name,
    risk: tool.risk,
    paramsRedacted: redactParams(params),
  };
}

async function runTool(
  deps: RuntimeDeps,
  actor: Actor,
  tool: AnyTool,
  params: unknown,
  runId: string,
  pendingActionId?: string,
): Promise<ToolOutcome> {
  const event = baseEvent(actor, tool, runId, params);
  try {
    const output = await tool.run(
      { actor, runId, db: deps.makeDb(actor.tenantId), usage: deps.usage },
      params,
    );
    if (tool.output) {
      const checked = tool.output.safeParse(output);
      if (!checked.success) throw new AgentError("invalid_output", `${tool.name} : sortie non conforme`);
    }
    await writeAudit(deps, { ...event, event: "executed", pendingActionId }, false);
    return { status: "ok", output };
  } catch (error) {
    const code: AgentErrorCode = error instanceof AgentError ? error.code : "tool_failed";
    await writeAudit(deps, { ...event, event: "failed", reason: code, pendingActionId }, false);
    return { status: "error", code };
  }
}

export async function executeTool(
  deps: RuntimeDeps,
  actorInput: unknown,
  call: { toolName: string; input: unknown; runId: string },
): Promise<ToolOutcome> {
  let actor: Actor;
  try {
    actor = assertActor(actorInput);
  } catch {
    return { status: "denied", reason: "actor_required" };
  }

  const tool = deps.registry.get(call.toolName);
  if (!tool) {
    await writeAudit(
      deps,
      { ...baseEvent(actor, { name: call.toolName, risk: "read" }, call.runId, call.input), event: "decision", decision: "deny", reason: "unknown_tool" },
      false,
    );
    return { status: "denied", reason: "unknown_tool" };
  }

  const parsed = tool.input.safeParse(call.input);
  const event = baseEvent(actor, tool, call.runId, parsed.success ? parsed.data : call.input);
  if (!parsed.success) {
    await writeAudit(deps, { ...event, event: "decision", decision: "deny", reason: "invalid_input" }, false);
    return { status: "denied", reason: "invalid_input" };
  }

  const evaluation = await deps.evaluate(actor, tool, parsed.data);
  const pendingActionId = evaluation.decision === "confirm" ? evaluation.pendingActionId : undefined;
  try {
    await writeAudit(
      deps,
      { ...event, event: "decision", decision: evaluation.decision, reason: evaluation.reason, pendingActionId },
      evaluation.decision !== "deny" && tool.risk !== "read",
    );
  } catch {
    return { status: "error", code: "audit_unavailable" };
  }

  switch (evaluation.decision) {
    case "deny":
      return { status: "denied", reason: evaluation.reason };
    case "confirm":
      return { status: "pending_confirmation", pendingActionId: evaluation.pendingActionId, reason: evaluation.reason };
    case "allow":
      return runTool(deps, actor, tool, parsed.data, call.runId);
  }
}

/** Approbation d'une carte : l'empreinte présentée doit être celle stockée. */
export async function approvePendingAction(
  deps: RuntimeDeps,
  approverInput: unknown,
  call: { toolName: string; pendingActionId: string; expectedHash: string },
): Promise<{ ok: true } | { ok: false; reason: ApprovalFailure | "actor_required" | "unknown_tool" }> {
  let approver: Actor;
  try {
    approver = assertActor(approverInput);
  } catch {
    return { ok: false, reason: "actor_required" };
  }
  const tool = deps.registry.get(call.toolName);
  if (!tool) return { ok: false, reason: "unknown_tool" };

  const result = await deps.pending.approve({
    approver,
    tool,
    pendingActionId: call.pendingActionId,
    expectedHash: call.expectedHash,
  });
  await writeAudit(
    deps,
    {
      ...baseEvent(approver, tool, undefined, {}),
      event: result.ok ? "approved" : "rejected",
      reason: result.ok ? undefined : result.reason,
      pendingActionId: call.pendingActionId,
    },
    false,
  );
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

/** Exécute une action approuvée avec les paramètres STOCKÉS (jamais ceux de l'appelant). */
export async function executeApprovedAction(
  deps: RuntimeDeps,
  actorInput: unknown,
  call: { toolName: string; pendingActionId: string; runId: string },
): Promise<ToolOutcome> {
  let actor: Actor;
  try {
    actor = assertActor(actorInput);
  } catch {
    return { status: "denied", reason: "actor_required" };
  }
  const tool = deps.registry.get(call.toolName);
  if (!tool) return { status: "denied", reason: "unknown_tool" };

  const claim = await deps.pending.claimForExecution({ actor, tool, pendingActionId: call.pendingActionId });
  if (!claim.ok) {
    await writeAudit(
      deps,
      { ...baseEvent(actor, tool, call.runId, {}), event: "decision", decision: "deny", reason: claim.reason, pendingActionId: call.pendingActionId },
      false,
    );
    return { status: "denied", reason: claim.reason };
  }

  const parsed = tool.input.safeParse(claim.value.params);
  if (!parsed.success) return { status: "error", code: "invalid_input" };
  return runTool(deps, actor, tool, parsed.data, call.runId, call.pendingActionId);
}
