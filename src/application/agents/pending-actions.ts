/**
 * Approbations liées à l'empreinte exacte des paramètres.
 *   - un « oui » ne vaut que pour l'empreinte présentée à l'approbateur ;
 *   - l'exécution relit les paramètres STOCKÉS (jamais ceux de l'appelant) et
 *     revérifie l'empreinte ;
 *   - le passage `approved -> executed` est atomique : une approbation ne sert qu'une fois.
 */
import type { Actor, Channel, PendingAction, PendingActionStatus, StepUpPort, ToolDef } from "./contracts";
import { paramsHash, redactParams } from "./canonical";
import type { PermissionMatrix } from "./role-matrix";

export interface PendingActionRow extends PendingAction {
  params: unknown;
}

export interface TransitionArgs {
  tenantId: string;
  id: string;
  from: PendingActionStatus[];
  to: PendingActionStatus;
  approvedBy?: string;
  /** Si fourni, la transition exige `expiresAt > notExpiredAt`. */
  notExpiredAt?: string;
}

export interface PendingActionRepository {
  insert(row: PendingActionRow & { runId?: string }): Promise<PendingActionRow>;
  /** Toujours filtré par tenant : un id d'un autre tenant renvoie null. */
  get(tenantId: string, id: string): Promise<PendingActionRow | null>;
  /** Mise à jour conditionnelle atomique ; null si aucune ligne n'a changé. */
  transition(args: TransitionArgs): Promise<PendingActionRow | null>;
}

export type ApprovalFailure =
  | "not_found"
  | "expired"
  | "params_changed"
  | "not_pending"
  | "not_authorized"
  | "step_up_required"
  | "self_approval_forbidden"
  | "not_approved"
  | "integrity_error";

export type ApprovalResult<T = PendingActionRow> = { ok: true; value: T } | { ok: false; reason: ApprovalFailure };

export interface PendingActionDeps {
  repo: PendingActionRepository;
  matrix: PermissionMatrix;
  /** Absent => fail-closed pour les outils `sensitive` (dépend de C2). */
  stepUp?: StepUpPort;
  /**
   * Q22 : renvoie true s'il existe, dans ce tenant, un AUTRE membre habilité à approuver.
   * Dans ce cas, un utilisateur ne peut pas approuver lui-même une action sensible qu'il a
   * demandée. Seul (aucun autre approbateur), il garde la possibilité de s'approuver.
   * Absent => comportement historique (auto-approbation permise).
   */
  hasOtherApprover?: (tenantId: string, requesterUserId: string) => Promise<boolean>;
  now?: () => Date;
  newId?: () => string;
}

export const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;

export function createPendingActionService(deps: PendingActionDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function request(args: {
    actor: Actor;
    tool: Pick<ToolDef<unknown, unknown>, "name">;
    params: unknown;
    runId?: string;
    ttlMs?: number;
  }): Promise<PendingActionRow> {
    const createdAt = now();
    return deps.repo.insert({
      id: newId(),
      tenantId: args.actor.tenantId,
      toolName: args.tool.name,
      params: args.params,
      paramsHash: paramsHash(args.actor.tenantId, args.tool.name, args.params),
      paramsPreview: redactParams(args.params) as Record<string, unknown>,
      status: "pending",
      requestedBy: args.actor.userId,
      channel: args.actor.channel as Channel,
      expiresAt: new Date(createdAt.getTime() + (args.ttlMs ?? DEFAULT_APPROVAL_TTL_MS)).toISOString(),
      runId: args.runId,
    });
  }

  async function approve(args: {
    approver: Actor;
    tool: Pick<ToolDef<unknown, unknown>, "name" | "risk" | "permission">;
    pendingActionId: string;
    /** Empreinte affichée sur la carte que l'approbateur vient de valider. */
    expectedHash: string;
  }): Promise<ApprovalResult> {
    const { approver, tool } = args;
    const row = await deps.repo.get(approver.tenantId, args.pendingActionId);
    if (!row || row.toolName !== tool.name) return { ok: false, reason: "not_found" };
    if (row.status !== "pending") return { ok: false, reason: "not_pending" };
    if (new Date(row.expiresAt).getTime() <= now().getTime()) {
      await deps.repo.transition({ tenantId: row.tenantId, id: row.id, from: ["pending"], to: "expired" });
      return { ok: false, reason: "expired" };
    }
    if (!deps.matrix.has(approver, tool.permission)) return { ok: false, reason: "not_authorized" };
    // Intégrité : l'empreinte stockée doit correspondre aux paramètres stockés ET à la carte validée.
    if (paramsHash(row.tenantId, row.toolName, row.params) !== row.paramsHash) {
      return { ok: false, reason: "integrity_error" };
    }
    if (args.expectedHash !== row.paramsHash) return { ok: false, reason: "params_changed" };
    if (tool.risk === "sensitive" && row.requestedBy === approver.userId && deps.hasOtherApprover) {
      let other = true; // en cas d'échec de la vérification : on suppose qu'un autre approbateur existe (refus par défaut)
      try {
        other = await deps.hasOtherApprover(row.tenantId, row.requestedBy);
      } catch {
        other = true;
      }
      if (other) return { ok: false, reason: "self_approval_forbidden" };
    }
    if (tool.risk === "sensitive") {
      if (!deps.stepUp) return { ok: false, reason: "step_up_required" };
      const { verified } = await deps.stepUp.requestStepUp(approver, row.id);
      if (!verified) return { ok: false, reason: "step_up_required" };
    }
    const updated = await deps.repo.transition({
      tenantId: row.tenantId,
      id: row.id,
      from: ["pending"],
      to: "approved",
      approvedBy: approver.userId,
      notExpiredAt: now().toISOString(),
    });
    return updated ? { ok: true, value: updated } : { ok: false, reason: "not_pending" };
  }

  async function reject(args: { approver: Actor; pendingActionId: string }): Promise<boolean> {
    const row = await deps.repo.get(args.approver.tenantId, args.pendingActionId);
    if (!row) return false;
    const updated = await deps.repo.transition({
      tenantId: row.tenantId,
      id: row.id,
      from: ["pending"],
      to: "rejected",
      approvedBy: args.approver.userId,
    });
    return updated !== null;
  }

  /**
   * Réclame l'exécution : retourne les paramètres STOCKÉS (revérifiés), ou un
   * motif de refus. Atomique : un second appel échoue (`not_approved`).
   */
  async function claimForExecution(args: {
    actor: Actor;
    tool: Pick<ToolDef<unknown, unknown>, "name" | "permission">;
    pendingActionId: string;
  }): Promise<ApprovalResult<{ params: unknown; row: PendingActionRow }>> {
    const row = await deps.repo.get(args.actor.tenantId, args.pendingActionId);
    if (!row || row.toolName !== args.tool.name) return { ok: false, reason: "not_found" };
    if (row.status !== "approved") return { ok: false, reason: "not_approved" };
    if (new Date(row.expiresAt).getTime() <= now().getTime()) {
      await deps.repo.transition({ tenantId: row.tenantId, id: row.id, from: ["approved"], to: "expired" });
      return { ok: false, reason: "expired" };
    }
    if (!deps.matrix.has(args.actor, args.tool.permission)) return { ok: false, reason: "not_authorized" };
    if (paramsHash(row.tenantId, row.toolName, row.params) !== row.paramsHash) {
      return { ok: false, reason: "integrity_error" };
    }
    const claimed = await deps.repo.transition({
      tenantId: row.tenantId,
      id: row.id,
      from: ["approved"],
      to: "executed",
      notExpiredAt: now().toISOString(),
    });
    return claimed ? { ok: true, value: { params: row.params, row: claimed } } : { ok: false, reason: "not_approved" };
  }

  /** Lecture d'une action en attente (toujours filtrée par tenant). */
  const get = (tenantId: string, id: string) => deps.repo.get(tenantId, id);

  return { request, approve, reject, claimForExecution, get };
}

export type PendingActionService = ReturnType<typeof createPendingActionService>;
