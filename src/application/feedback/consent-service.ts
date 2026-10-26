/**
 * Consentements d'entraînement (P5) — OPT-IN strict : sans événement `granted`,
 * il n'y a pas de consentement. Seul un propriétaire, depuis le tableau de
 * bord, accorde ou retire ; chaque décision est journalisée (append-only) et
 * auditée. Le retrait est immédiat (l'export relit l'état à chaque appel).
 */
import { AgentError } from "@/application/agents/errors";
import type { Actor } from "@/application/agents/contracts";
import type { AuditSink } from "@/application/agents/audit";

export type ConsentScope = "feedback_export" | "model_improvement";
const SCOPES: readonly ConsentScope[] = ["feedback_export", "model_improvement"];

export interface ConsentRepository {
  has(tenantId: string, scope: ConsentScope): Promise<boolean>;
  record(input: { tenantId: string; scope: ConsentScope; granted: boolean; decidedBy: string; policyVersion: string }): Promise<"granted" | "revoked" | "forbidden">;
}

export function createConsentService(deps: { repo: ConsentRepository; audit: AuditSink }) {
  return {
    has: (tenantId: string, scope: ConsentScope) => deps.repo.has(tenantId, scope),

    async decide(actor: Actor, input: { scope: ConsentScope; granted: boolean; policyVersion: string }) {
      if (!SCOPES.includes(input.scope)) throw new AgentError("consent_forbidden", "Portée inconnue");
      if (!input.policyVersion || input.policyVersion.length > 50) throw new AgentError("consent_forbidden", "Version de politique requise");
      // Décision juridique : propriétaire uniquement, session tableau de bord (jamais un agent, un canal de messagerie ou un client).
      if (actor.role !== "owner" || actor.channel !== "dashboard") throw new AgentError("consent_forbidden", "Réservé au propriétaire");
      const outcome = await deps.repo.record({
        tenantId: actor.tenantId, scope: input.scope, granted: input.granted, decidedBy: actor.userId, policyVersion: input.policyVersion,
      });
      if (outcome === "forbidden") throw new AgentError("consent_forbidden", "Réservé au propriétaire");
      // L'audit est obligatoire : s'il échoue, l'erreur remonte (la décision reste journalisée en base).
      await deps.audit.record({
        tenantId: actor.tenantId, actorUserId: actor.userId, channel: actor.channel, toolName: "training.consent",
        risk: "sensitive", event: "executed", paramsRedacted: { scope: input.scope, granted: input.granted, policyVersion: input.policyVersion },
      });
      return outcome;
    },
  };
}
