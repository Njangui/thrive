import type { OrderStatus } from "@/application/services/order-service";

/**
 * Libellés/couleurs de statut commande — extrait de `orders/page.tsx`
 * (sept. 2026, chantier d'unification design) pour être réutilisé tel
 * quel par l'accueil du dashboard ("Commandes récentes"), plutôt que
 * dupliquer/réinventer un second wording pour la même donnée.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  completed: "Terminée",
  cancelled: "Annulée",
};

export const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  pending: "bg-slate-100 text-slate-600",
  confirmed: "bg-amber-500/10 text-amber-600",
  completed: "bg-success-50 text-success-700",
  cancelled: "bg-danger-50 text-danger-700",
};
