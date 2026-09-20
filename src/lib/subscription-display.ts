/**
 * Libellés d'abonnement de la console Super Admin — fonctions PURES (testées).
 *
 * Modèle freemium : l'offre gratuite (plan `free`) est permanente, sans échéance ; il n'y a plus
 * de période d'essai. Le statut `trialing` n'existe plus que comme état hérité (anciennes lignes
 * ou repli d'une organisation sans ligne d'abonnement) et reste donc identifié comme tel.
 * Types volontairement `string` : ce module ne dépend d'aucune couche applicative.
 */

/** Libellé du badge d'abonnement. Un plan `free` actif n'est pas un « abonnement actif ». */
export function subscriptionBadgeLabel(planKey: string, status: string): string {
  if (status === "active") return planKey === "free" ? "Offre gratuite" : "Abonnement actif";
  switch (status) {
    case "trialing":
      return "Essai (hérité)";
    case "past_due":
      return "Impayé";
    case "cancelled":
      return "Résilié";
    default:
      return status;
  }
}

export interface SubscriptionDueInput {
  planKey: string;
  status: string;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
}

/** Ligne « Échéance » de la fiche entreprise : libellé + valeur, jamais un « Essai jusqu'au » trompeur. */
export function subscriptionDueLine(input: SubscriptionDueInput): { label: string; value: string } {
  const format = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");

  if (input.status === "trialing") {
    return { label: "Fin d'essai (hérité)", value: format(input.trialEnd) };
  }
  if (input.planKey === "free" && input.status === "active") {
    return { label: "Échéance", value: "Aucune (offre gratuite)" };
  }
  return { label: "Échéance", value: format(input.currentPeriodEnd) };
}
