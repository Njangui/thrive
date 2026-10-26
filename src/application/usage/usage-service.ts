/**
 * Registre d'usage (P3) — implémente `UsageService` du noyau agentique.
 *
 * Le service ne fait QUE valider l'entrée et déléguer au dépôt (SQL atomique,
 * idempotent par (organisation, ref)). Aucun prix ici : on compte des unités,
 * la valeur monétaire d'une unité n'est jamais codée en dur (modèle de prix
 * v2 non décidé).
 */
import { AgentError } from "@/application/agents/errors";
import type { UsageChargeInput, UsageChargeResult, UsageKind, UsageService } from "@/application/agents/contracts";

export type UsageSource = "plan" | "wallet";

export interface UsageLedgerRepository {
  charge(input: UsageChargeInput): Promise<UsageChargeResult & { source?: UsageSource; lowBalance?: boolean }>;
  reserve(input: UsageChargeInput): Promise<{ status: "reserved" | "duplicate" | "insufficient"; source?: UsageSource; lowBalance?: boolean }>;
  commit(tenantId: string, ref: string): Promise<"committed" | "duplicate" | "released" | "not_found">;
  release(tenantId: string, ref: string): Promise<{ status: string; source?: UsageSource }>;
  refund(tenantId: string, ref: string, reason: string): Promise<{ status: string; source?: UsageSource }>;
}

export interface UsageServiceDeps {
  repo: UsageLedgerRepository;
  /** Appelé (best-effort) quand le solde passe sous le seuil d'alerte. */
  onLowBalance?: (tenantId: string, kind: UsageKind) => Promise<void> | void;
}

const KINDS: readonly UsageKind[] = ["ai", "media", "message", "channel"] as const;

function validate(input: UsageChargeInput): void {
  if (!input.tenantId || !input.actorId) throw new AgentError("usage_invalid", "Organisation et acteur requis");
  if (!KINDS.includes(input.kind)) throw new AgentError("usage_invalid", "Type d'usage inconnu");
  if (!Number.isFinite(input.units) || input.units <= 0) throw new AgentError("usage_invalid", "Unités invalides");
  if (!input.ref || input.ref.length > 200) throw new AgentError("usage_invalid", "Référence d'idempotence invalide");
}

export interface UsageLedgerService extends UsageService {
  reserve: UsageLedgerRepository["reserve"];
  commit(tenantId: string, ref: string): ReturnType<UsageLedgerRepository["commit"]>;
  release(tenantId: string, ref: string): ReturnType<UsageLedgerRepository["release"]>;
  refund(tenantId: string, ref: string, reason: string): ReturnType<UsageLedgerRepository["refund"]>;
}

export function createUsageService(deps: UsageServiceDeps): UsageLedgerService {
  const alert = async (tenantId: string, kind: UsageKind, low?: boolean) => {
    if (!low || !deps.onLowBalance) return;
    try { await deps.onLowBalance(tenantId, kind); } catch { /* alerte best-effort */ }
  };
  return {
    async charge(input) {
      validate(input);
      const r = await deps.repo.charge(input);
      await alert(input.tenantId, input.kind, r.lowBalance);
      return { status: r.status, ledgerId: r.ledgerId };
    },
    async reserve(input) {
      validate(input);
      const r = await deps.repo.reserve(input);
      await alert(input.tenantId, input.kind, r.lowBalance);
      return r;
    },
    commit: (tenantId, ref) => deps.repo.commit(tenantId, ref),
    release: (tenantId, ref) => deps.repo.release(tenantId, ref),
    refund: (tenantId, ref, reason) => deps.repo.refund(tenantId, ref, reason.slice(0, 200)),
  };
}
