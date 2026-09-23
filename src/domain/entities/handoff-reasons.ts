import type { HandoffReason } from "./conversation";

/**
 * Lot P — libellés français des motifs d'escalade. Avant ce fichier, la
 * liste des conversations et les notifications affichaient les codes bruts
 * (« ai_unavailable », « semi_automatic ») au commerçant.
 *
 * Volontairement SANS dépendance (pas de zod) : importable depuis un
 * composant serveur, un service ou un test sans rien charger d'autre.
 */
export const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  low_confidence: "Réponse incertaine — à vérifier",
  complaint: "Réclamation du client",
  refund_request: "Demande de remboursement",
  high_value_negotiation: "Négociation à fort enjeu",
  high_value_prospect: "Prospect à fort potentiel",
  complex_request: "Demande complexe",
  unknown_information: "Information non renseignée",
  requires_human_action: "Action humaine nécessaire",
  ai_unavailable: "Question hors FAQ, infos et catalogue (assistant IA indisponible)",
  semi_automatic: "Question hors FAQ, infos et catalogue",
};

/** Libellé lisible d'un motif ; `null` si aucun motif. Un code inconnu est renvoyé tel quel plutôt que perdu. */
export function describeHandoffReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (HANDOFF_REASON_LABELS as Record<string, string>)[reason] ?? reason;
}
