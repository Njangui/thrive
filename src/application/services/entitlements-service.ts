import { getOrganizationPlanKey, getEntitlementLimit, countOrganizationRows } from "./plans-repository";
import { getCreditStatus } from "./ai-credits-service";

/**
 * Lot B — LA fonction centrale de vérification des droits (section 34-36,
 * 62-63 du master prompt produit). Aucun `if plan === "pro"` ne doit
 * exister ailleurs dans le code : tout passe par `canUseFeature()`.
 */
export interface EntitlementCheckResult {
  allowed: boolean;
  /** -1 = illimité. */
  limit: number;
  used: number;
  /** -1 = illimité. */
  remaining: number;
}

/**
 * Clés d'entitlement dont l'usage est CUMULATIF (compte total actuel,
 * pas par action). Toute clé absente de cet ensemble est traitée comme
 * une limite "par action" ou booléenne : `used` n'a pas de sens cumulatif
 * (broadcast_contacts = un plafond par campagne ; facebook_messenger/
 * instagram_messages/linkedin/tiktok = 0/1, une fonctionnalité activée ou
 * non). Voir le cahier des charges, section "deux natures de limites".
 *
 * 'ai_credits' est cumulatif mais traité à part (délègue à
 * getCreditStatus) car son usage est suivi dans sa propre table
 * (ai_credit_balances), pas comptable par un simple `count(*)`.
 */
const CUMULATIVE_TABLE_BY_KEY: Record<string, string> = {
  whatsapp_groups: "whatsapp_groups",
  // NB: 'social_accounts' n'est PAS traité ici en mode cumulatif : il
  // n'existe aujourd'hui aucune table "comptes sociaux connectés" dans le
  // code fourni (provider_connections est une ligne par (org, type,
  // provider), pas par compte Facebook/Instagram/TikTok individuel — voir
  // rapport de livraison). Le traiter en mode "par action" (comparer le
  // nombre de comptes ciblés par une opération donnée à la limite du
  // plan, cf. l'intégration dans marketing-service.ts) évite de deviner
  // un modèle de données qui appartient à un autre lot.
};

/**
 * Combine (limite, usage, quantité demandée) en un résultat exploitable.
 * Fonction pure, exportée pour être testée exhaustivement sans DB.
 *
 * - limite illimitée (-1) : toujours autorisé.
 * - mode cumulatif : `used` est le compte total actuel, on vérifie que
 *   used + requestedAmount ne dépasse pas la limite.
 * - mode "par action"/booléen : appelé avec used=0, ce qui réduit la
 *   même formule à `requestedAmount <= limit` (ex: 0/1 pour un booléen,
 *   N contacts pour un plafond par campagne).
 */
export function evaluateEntitlement(limit: number, used: number, requestedAmount: number): EntitlementCheckResult {
  if (limit === -1) {
    return { allowed: true, limit: -1, used, remaining: -1 };
  }
  const remaining = Math.max(limit - used, 0);
  const allowed = used + requestedAmount <= limit;
  return { allowed, limit, used, remaining };
}

export async function canUseFeature(
  organizationId: string,
  entitlementKey: string,
  requestedAmount = 1,
): Promise<EntitlementCheckResult> {
  // Cas particulier : les crédits IA ont leur propre table de suivi
  // (déjà rattachée au plan via initializeCreditBalance), pas une simple
  // limite statique — on délègue entièrement (section "Ce qui existe
  // déjà" du cahier : "pour ai_credits, déléguer à getCreditStatus()").
  if (entitlementKey === "ai_credits") {
    const status = await getCreditStatus(organizationId);
    return evaluateEntitlement(status.includedCredits, status.usedCredits, requestedAmount);
  }

  const planKey = await getOrganizationPlanKey(organizationId);
  const limit = await getEntitlementLimit(planKey, entitlementKey);

  const cumulativeTable = CUMULATIVE_TABLE_BY_KEY[entitlementKey];
  const used = limit === -1 ? 0 : cumulativeTable ? await countOrganizationRows(cumulativeTable, organizationId) : 0;

  return evaluateEntitlement(limit, used, requestedAmount);
}
