import { getOrganizationPlanKey, getEntitlementLimit, countOrganizationRows, type PlanKey } from "./plans-repository";
import { getCreditStatus } from "./ai-credits-service";
import { getOrganizationAddonBonus } from "./addons-service";
import { hasDedicatedPhoneNumber } from "./phone-number-repository";

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
interface CumulativeTableConfig {
  table: string;
  /**
   * Lot F : si la table a une colonne `status`, ne compter que ces
   * valeurs contre le quota. Sans ce filtre, désactiver une ressource
   * (ex: déconnecter un groupe WhatsApp) ne libérerait jamais son quota —
   * la ligne resterait comptée indéfiniment (`countOrganizationRows`
   * compte toutes les lignes de l'org par défaut). Omis = comportement
   * historique (aucun filtre, toutes les lignes comptent).
   */
  activeStatuses?: string[];
}

const CUMULATIVE_TABLE_BY_KEY: Record<string, CumulativeTableConfig> = {
  // whatsapp_groups.status ∈ {'connected','disconnected','error'} — seul
  // 'connected' doit peser sur le quota (Lot F, voir whatsapp-group-service.ts).
  whatsapp_groups: { table: "whatsapp_groups", activeStatuses: ["connected"] },
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

/**
 * Bonus "numéro dédié" (section 55 du master prompt) : deux lectures
 * séquentielles par nature (impossible de connaître la clé de bonus à
 * appliquer avant de savoir si l'organisation a un numéro assigné) —
 * isolées dans leur propre fonction pour que `canUseFeature()` puisse
 * lancer toute cette chaîne EN PARALLÈLE de ses deux autres lectures
 * indépendantes (add-ons, usage cumulatif) plutôt que de la bloquer
 * derrière elles (voir le commentaire dans canUseFeature ci-dessous).
 */
async function resolveDedicatedNumberBonus(organizationId: string, planKey: PlanKey): Promise<number> {
  const hasDedicated = await hasDedicatedPhoneNumber(organizationId);
  if (!hasDedicated) return 0;
  // `getEntitlementLimit` renvoie -1 pour "clé non configurée", ce qui
  // signifie "illimité" pour une LIMITE mais n'a aucun sens pour un
  // bonus additif : traité comme 0 ici (`> 0` garde), jamais un bonus
  // négatif ni infini par accident.
  const rawBonus = await getEntitlementLimit(planKey, "whatsapp_groups_dedicated_bonus");
  return rawBonus > 0 ? rawBonus : 0;
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
  // Un add-on ciblant 'ai_credits' ne passe donc PAS par le bonus
  // générique ci-dessous (Lot G) : il top-up directement
  // `ai_credit_balances` via grantCredits() au moment du paiement
  // confirmé (voir addons-service.ts::confirmAddonPurchase) —
  // getCreditStatus() reflète alors déjà le bonus sans logique
  // supplémentaire ici.
  if (entitlementKey === "ai_credits") {
    const status = await getCreditStatus(organizationId);
    return evaluateEntitlement(status.includedCredits, status.usedCredits, requestedAmount);
  }

  const planKey = await getOrganizationPlanKey(organizationId);
  const planLimit = await getEntitlementLimit(planKey, entitlementKey);

  // Plan déjà illimité : `limit` vaudra -1 quoi qu'il arrive (aucun
  // bonus, aucun usage ne peut changer ça) — retour immédiat, zéro
  // requête DB supplémentaire sur le chemin le plus fréquent (plan
  // "pro"). Comportement identique à l'ancien code (qui arrivait au
  // même résultat après plusieurs lectures toutes court-circuitées à
  // 0/ignorées), juste rendu explicite.
  if (planLimit === -1) {
    return evaluateEntitlement(-1, 0, requestedAmount);
  }

  // Optimisation (Lot 4) : ces trois lectures sont indépendantes les
  // unes des autres — aucune ne dépend du RÉSULTAT d'une autre, chacune
  // dépend seulement de `planLimit !== -1` (déjà acquis ci-dessus). Les
  // lancer en parallèle plutôt qu'en séquence réduit le nombre
  // d'allers-retours DB sur ce chemin, qui est appelé à CHAQUE
  // vérification de droit (créer un groupe WhatsApp, lancer une
  // diffusion, publier sur un réseau...), donc potentiellement très
  // fréquent. Pire cas (whatsapp_groups, plan non illimité, numéro
  // dédié assigné) : 4 allers-retours séquentiels au lieu de 6
  // auparavant (planKey, planLimit, puis 2 lectures en parallèle au
  // lieu de 4 empilées : add-ons ; numéro dédié, qui reste lui-même
  // séquentiel en interne — voir resolveDedicatedNumberBonus — mais ne
  // bloque plus les deux autres ; usage cumulatif).
  const cumulative = CUMULATIVE_TABLE_BY_KEY[entitlementKey];
  const [addonBonus, dedicatedNumberBonus, used] = await Promise.all([
    getOrganizationAddonBonus(organizationId, entitlementKey),
    // Ne concerne QUE 'whatsapp_groups' (seule clé pour laquelle le
    // master prompt décrit ce bonus, section 55).
    entitlementKey === "whatsapp_groups" ? resolveDedicatedNumberBonus(organizationId, planKey) : Promise.resolve(0),
    cumulative ? countOrganizationRows(cumulative.table, organizationId, cumulative.activeStatuses) : Promise.resolve(0),
  ]);

  const limit = planLimit + addonBonus + dedicatedNumberBonus;
  return evaluateEntitlement(limit, used, requestedAmount);
}
