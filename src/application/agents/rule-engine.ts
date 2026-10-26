/**
 * Moteur de règles : déterministe, en code (principe 4). Ordre d'évaluation :
 *   1 acteur -> 2 entrée valide -> 3 outil disponible (liste + politique `deny`) ->
 *   4 zone de confiance -> 5 permission (rôle / extra_permissions) ->
 *   6 GARDE-FOUS FIXES (jamais configurables) -> 7 politique du propriétaire (auto / valider).
 * Le premier refus l'emporte.
 *
 * Garde-fous fixes — aucun réglage du propriétaire ne peut les lever :
 *   - toute action `sensitive` (remboursement, annulation, prix, suppression, droits, abonnement...) est confirmée ;
 *   - un envoi à plus de MAX_AUTO_BULK_MESSAGES destinataires est confirmé ;
 *   - une action dont le coût estimé dépasse le plafond par action est confirmée.
 * Raison d'être : une phrase mal comprise, ou une consigne glissée dans un message client, ne doit jamais pouvoir
 * vider un compte ni envoyer des milliers de messages sans l'accord d'un humain.
 */
import type { Actor, CostEstimate, EvaluateAction, EvaluationResult, ToolDef } from "./contracts";
import { trustZoneOf } from "./contracts";
import { assertActor } from "./actor";
import { AgentError } from "./errors";
import { paramsHash } from "./canonical";
import type { PendingActionService } from "./pending-actions";
import type { PermissionMatrix } from "./role-matrix";
import { DEFAULT_MAX_UNITS_PER_ACTION, defaultAgentSettings, effectiveWritePolicy, isToolEnabled, type AgentSettings, type AgentSettingsRepository } from "./settings";

export type Verdict = { decision: "allow" | "confirm" | "deny"; reason: string };

/** Garde-fou fixe : au-delà, un envoi groupé exige toujours l'accord d'un humain. */
export const MAX_AUTO_BULK_MESSAGES = 20;

export function totalUnits(estimate: CostEstimate | undefined): number {
  return (estimate?.items ?? []).reduce((sum, item) => sum + item.units, 0);
}

function messageUnits(estimate: CostEstimate | undefined): number {
  return (estimate?.items ?? []).filter((i) => i.kind === "message").reduce((sum, item) => sum + item.units, 0);
}

/**
 * Cœur pur (sans E/S) : testable exhaustivement. `input` est déjà validé par le schéma de l'outil.
 * `amount` : `undefined` = l'outil n'a pas de dimension monétaire ; `null` = montant inconnu ; nombre = montant calculé.
 */
export function decide(args: {
  actor: Actor;
  tool: ToolDef<unknown, unknown>;
  input: unknown;
  settings: AgentSettings;
  matrix: PermissionMatrix;
  amount?: number | null;
}): Verdict {
  const { actor, tool, settings, matrix } = args;

  if (!isToolEnabled(settings, tool)) return { decision: "deny", reason: "tool_disabled" };

  if (trustZoneOf(actor.channel) === "storefront") {
    // Zone vitrine : lecture/brouillon inerte uniquement, sans confirmation possible.
    if (!tool.storefrontSafe || tool.risk === "sensitive") return { decision: "deny", reason: "storefront_forbidden" };
    return { decision: "allow", reason: "storefront_safe" };
  }

  if (!matrix.has(actor, tool.permission)) return { decision: "deny", reason: "permission_denied" };

  // --- Garde-fous fixes ---
  if (tool.risk === "sensitive") return { decision: "confirm", reason: "sensitive_always_confirmed" };
  if (tool.confirmAlways && tool.risk !== "read") return { decision: "confirm", reason: "always_confirmed" };

  const estimate = tool.estimateCost?.(args.input);
  if (messageUnits(estimate) > MAX_AUTO_BULK_MESSAGES) return { decision: "confirm", reason: "bulk_send_requires_approval" };
  const cap = settings.budget.maxUnitsPerAction ?? DEFAULT_MAX_UNITS_PER_ACTION;
  if (tool.estimateCost && totalUnits(estimate) > cap) return { decision: "confirm", reason: "budget_cap_exceeded" };

  // --- Politique du propriétaire ---
  if (tool.risk === "read") return { decision: "allow", reason: "read" };

  const policy = effectiveWritePolicy(settings, tool.name);
  if (policy.mode !== "auto") return { decision: "confirm", reason: "autonomy_confirm" };
  if (policy.autoMaxAmount !== undefined && args.amount !== undefined) {
    if (args.amount === null) return { decision: "confirm", reason: "amount_unknown" };
    if (args.amount > policy.autoMaxAmount) return { decision: "confirm", reason: "amount_over_threshold" };
  }
  return { decision: "allow", reason: "autonomy_allow" };
}

export interface EvaluatorDeps {
  settings: AgentSettingsRepository;
  matrix: PermissionMatrix;
  pending: PendingActionService;
}

/** `evaluateAction` du contrat : crée la carte d'approbation quand la décision est `confirm`. */
export function createActionEvaluator(deps: EvaluatorDeps): EvaluateAction {
  return async function evaluateAction(actorInput, tool, input): Promise<EvaluationResult> {
    let actor: Actor;
    try {
      actor = assertActor(actorInput);
    } catch (error) {
      if (error instanceof AgentError) return { decision: "deny", reason: "actor_required" };
      throw error;
    }

    const parsed = tool.input.safeParse(input);
    if (!parsed.success) return { decision: "deny", reason: "invalid_input" };

    const settings = (await deps.settings.get(actor.tenantId)) ?? defaultAgentSettings(actor.tenantId);
    // Montant calculé par le CODE (jamais par le modèle) ; seulement utile pour une écriture en mode auto avec seuil.
    let amount: number | null | undefined;
    if (tool.amountOf && tool.risk === "write_reversible") {
      try {
        const v = await tool.amountOf({ actor }, parsed.data);
        amount = typeof v === "number" && Number.isFinite(v) ? v : null;
      } catch {
        amount = null; // résolution impossible : traité comme « inconnu » => validation
      }
    }
    const verdict = decide({ actor, tool, input: parsed.data, settings, matrix: deps.matrix, amount });
    if (verdict.decision !== "confirm") return verdict as EvaluationResult;

    const row = await deps.pending.request({ actor, tool, params: parsed.data });
    return { decision: "confirm", reason: verdict.reason, pendingActionId: row.id };
  };
}

export { paramsHash };
