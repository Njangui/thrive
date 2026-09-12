import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError } from "@/lib/errors";
import { getOrganizationPlanKey, getEntitlementLimit } from "./plans-repository";

/**
 * ⚠️ Ce fichier n'existait PAS dans le code source fourni pour ce lot,
 * bien que 02_LOT_B_plans_entitlements.md le décrive comme "déjà
 * construit et fonctionnel" avec exactement ces 5 fonctions, déjà
 * branché dans ai-response-service.ts et conversation-orchestrator.ts.
 * Vérifié par recherche exhaustive ("credit" absent de tout le repo).
 * Voir le rapport de livraison Lot B pour le détail de cet écart et la
 * décision prise : recréer une implémentation réelle (pas un stub
 * permissif) puisque `entitlements-service.ts::canUseFeature('ai_credits')`
 * en dépend structurellement pour être autre chose qu'un mock.
 *
 * CE QUI N'EST PAS FAIT ICI (hors périmètre Lot B, à faire par l'équipe
 * qui possède réellement ai-response-service.ts / conversation-
 * orchestrator.ts) : bloquer l'appel IA quand hasCreditsAvailable() est
 * faux, et escalader avec une raison dédiée. `HandoffReasonSchema`
 * (domain/entities/conversation.ts) n'a pas été modifié par ce lot pour
 * éviter d'élargir le rayon d'impact sur un fichier domaine partagé sans
 * certitude sur l'équipe qui le possède.
 */

export interface CreditStatus {
  organizationId: string;
  /** -1 = illimité. Snapshot pris à l'initialisation (voir ai_credit_balances). */
  includedCredits: number;
  usedCredits: number;
  /** -1 = illimité. */
  remainingCredits: number;
}

/**
 * Statut de crédits d'une organisation. Ne lève jamais : si
 * `ai_credit_balances` n'a pas encore de ligne (tenant créé avant ce lot,
 * ou `initializeCreditBalance` pas encore appelée), calcule un statut
 * "virtuel" depuis le plan plutôt que d'inventer un solde à zéro qui
 * bloquerait l'IA à tort.
 */
export async function getCreditStatus(organizationId: string): Promise<CreditStatus> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("ai_credit_balances")
    .select("included_credits, used_credits")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    console.error(`getCreditStatus(${organizationId}) erreur de lecture:`, error.message);
  }

  if (!data) {
    const planKey = await getOrganizationPlanKey(organizationId);
    const includedCredits = await getEntitlementLimit(planKey, "ai_credits");
    return { organizationId, includedCredits, usedCredits: 0, remainingCredits: includedCredits };
  }

  const includedCredits = data.included_credits;
  const usedCredits = data.used_credits;
  return {
    organizationId,
    includedCredits,
    usedCredits,
    remainingCredits: includedCredits === -1 ? -1 : Math.max(includedCredits - usedCredits, 0),
  };
}

export async function hasCreditsAvailable(organizationId: string, amount = 1): Promise<boolean> {
  const status = await getCreditStatus(organizationId);
  return status.includedCredits === -1 || status.remainingCredits >= amount;
}

/**
 * Consomme atomiquement des crédits (Lot 3, corrige la race condition
 * documentée jusqu'ici — voir 0038_ai_credits_atomic.sql). Renvoie
 * `{ success: false }` plutôt que de lever si le solde est insuffisant :
 * c'est un résultat métier normal (l'appelant doit alors escalader vers
 * un humain, jamais une exception à catcher). N'empêche PAS elle-même
 * l'appel IA — c'est à l'appelant de réserver le crédit AVANT de
 * générer (voir ai-response-service.ts) et de le libérer avec
 * `releaseCredit()` si la génération échoue malgré tout après coup.
 */
export async function consumeCredit(
  organizationId: string,
  amount = 1,
  reason = "ai_reply",
  metadata: Record<string, unknown> = {},
): Promise<{ success: boolean }> {
  if (amount <= 0) {
    throw new ValidationError("Le nombre de crédits consommés doit être positif");
  }

  const supabase = getSupabaseServiceClient();

  let { data, error } = await supabase.rpc("consume_ai_credit", {
    p_organization_id: organizationId,
    p_amount: amount,
  });

  if (error) {
    throw new Error(`Impossible de consommer les crédits IA: ${error.message}`);
  }

  if (!data || data.length === 0) {
    // Zéro ligne renvoyée = solde insuffisant OU ligne jamais initialisée
    // (voir commentaire de la fonction SQL) — on distingue les deux en
    // relisant le statut plutôt que de deviner.
    const status = await getCreditStatus(organizationId);
    const wasNeverInitialized = status.includedCredits !== -1 && status.usedCredits === 0 && status.remainingCredits >= amount;

    if (wasNeverInitialized) {
      // Filet de sécurité pour un tenant créé avant ce mécanisme : on
      // initialise à la volée puis on retente UNE fois — jamais une
      // boucle, pour ne jamais masquer un vrai solde épuisé en cas
      // d'erreur de lecture répétée.
      await initializeCreditBalance(organizationId);
      ({ data, error } = await supabase.rpc("consume_ai_credit", {
        p_organization_id: organizationId,
        p_amount: amount,
      }));
      if (error) {
        throw new Error(`Impossible de consommer les crédits IA: ${error.message}`);
      }
    }
  }

  const success = !!data && data.length > 0;

  if (!success) {
    return { success: false };
  }

  const { error: eventError } = await supabase
    .from("ai_usage_events")
    .insert({ organization_id: organizationId, type: "consumption", amount, reason, metadata });

  if (eventError) {
    // Le solde est déjà à jour (ce qui compte pour le gating) — l'échec
    // du log d'historique ne doit pas remonter comme un échec de
    // consommation.
    console.error(`consumeCredit(${organizationId}): échec de journalisation ai_usage_events:`, eventError.message);
  }

  return { success: true };
}

/**
 * Rembourse un crédit précédemment réservé par `consumeCredit()` — appelé
 * quand la génération IA échoue malgré la réservation (voir
 * ai-response-service.ts::generateAIReply). Best-effort : un échec de
 * remboursement ne doit jamais faire échouer le traitement de l'erreur
 * IA d'origine, juste laisser le solde légèrement sous-remboursé (loggé).
 */
export async function releaseCredit(organizationId: string, amount = 1, reason = "ai_generation_failed"): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { error } = await supabase.rpc("release_ai_credit", {
    p_organization_id: organizationId,
    p_amount: amount,
  });

  if (error) {
    console.error(`releaseCredit(${organizationId}): échec du remboursement:`, error.message);
    return;
  }

  const { error: eventError } = await supabase
    .from("ai_usage_events")
    .insert({ organization_id: organizationId, type: "release", amount, reason });

  if (eventError) {
    console.error(`releaseCredit(${organizationId}): échec de journalisation ai_usage_events:`, eventError.message);
  }
}

/**
 * Initialise (ou réinitialise à zéro consommé) le solde d'une
 * organisation. Appelée depuis `onboarding-service.ts::createOrganization`
 * SANS argument — la valeur incluse est alors résolue depuis le plan de
 * l'organisation (`plan_entitlements` pour la clé 'ai_credits'), ce qui
 * remplace l'ancienne constante `DEFAULT_INCLUDED_CREDITS = 500` décrite
 * dans le cahier des charges. Signature volontairement compatible avec
 * un appel explicite (`initializeCreditBalance(orgId, 1500)`) pour Lot C
 * (Super Admin) ou un ajustement manuel.
 */
export async function initializeCreditBalance(organizationId: string, includedCredits?: number): Promise<void> {
  const resolvedIncluded =
    includedCredits ?? (await getEntitlementLimit(await getOrganizationPlanKey(organizationId), "ai_credits"));

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("ai_credit_balances").upsert(
    { organization_id: organizationId, included_credits: resolvedIncluded, used_credits: 0 },
    { onConflict: "organization_id", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`Impossible d'initialiser le solde de crédits IA: ${error.message}`);
  }
}

/**
 * Ajoute des crédits (achat complémentaire, geste commercial). Exposée
 * pour Lot C (Super Admin) — pas d'UI commerçant dans ce lot.
 */
export async function grantCredits(organizationId: string, amount: number, reason = "manual_grant"): Promise<void> {
  if (amount <= 0) {
    throw new ValidationError("Le nombre de crédits à ajouter doit être positif");
  }

  const supabase = getSupabaseServiceClient();
  const { data: balance, error: readError } = await supabase
    .from("ai_credit_balances")
    .select("included_credits")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Impossible de lire le solde de crédits IA: ${readError.message}`);
  }

  if (!balance) {
    await initializeCreditBalance(organizationId);
  }

  const currentIncluded =
    balance?.included_credits ?? (await getEntitlementLimit(await getOrganizationPlanKey(organizationId), "ai_credits"));

  // Illimité : rien à additionner, mais on trace quand même l'évènement
  // (utile pour l'historique Super Admin).
  if (currentIncluded !== -1) {
    const { error: updateError } = await supabase
      .from("ai_credit_balances")
      .update({ included_credits: currentIncluded + amount })
      .eq("organization_id", organizationId);

    if (updateError) {
      throw new Error(`Impossible d'ajouter les crédits IA: ${updateError.message}`);
    }
  }

  const { error: eventError } = await supabase
    .from("ai_usage_events")
    .insert({ organization_id: organizationId, type: "grant", amount, reason });

  if (eventError) {
    console.error(`grantCredits(${organizationId}): échec de journalisation ai_usage_events:`, eventError.message);
  }
}
