/**
 * Pont C1 ↔ C2 : le noyau (C1) demande « cette action sensible est-elle validée ? » ; la validation renforcée (C2)
 * répond avec un défi lié à l'EMPREINTE EXACTE des paramètres stockés.
 *
 * Flux : le canal vérifie le PIN / le lien (C2) puis appelle `decideApproval` avec l'identifiant du défi. L'adaptateur
 * le mémorise (`remember`) le temps de l'approbation ; `requestStepUp` le consomme (usage unique) en recalculant l'empreinte
 * depuis les paramètres STOCKÉS : un défi approuvé pour une autre action, un autre membre ou déjà utilisé échoue.
 */
import type { Actor, StepUpPort as KernelStepUpPort } from "@/application/agents/contracts";
import { computeActionFingerprint } from "@/application/channels/action-fingerprint";
import type { StepUpPort as ChannelStepUpPort } from "@/domain/ports/step-up-port";

export interface PendingParamsReader {
  get(tenantId: string, id: string): Promise<{ toolName: string; params: unknown } | null>;
}

export function createStepUpBridge(deps: { stepUp: Pick<ChannelStepUpPort, "consume">; pending: PendingParamsReader }) {
  const challenges = new Map<string, string>();
  const port: KernelStepUpPort = {
    async requestStepUp(actor: Actor, pendingActionId: string) {
      const challengeId = challenges.get(pendingActionId);
      if (!challengeId || !actor.membershipId) return { verified: false };
      try {
        const row = await deps.pending.get(actor.tenantId, pendingActionId);
        if (!row) return { verified: false };
        const result = await deps.stepUp.consume({
          challengeId,
          organizationId: actor.tenantId,
          membershipId: actor.membershipId,
          actionFingerprint: computeActionFingerprint(row.toolName, row.params),
        });
        return { verified: result.ok };
      } catch {
        return { verified: false };
      } finally {
        challenges.delete(pendingActionId);
      }
    },
  };
  return {
    port,
    /** Mémorise le défi déjà approuvé pour cette action, juste avant `approve`. */
    remember(pendingActionId: string, challengeId: string) {
      challenges.set(pendingActionId, challengeId);
    },
  };
}
