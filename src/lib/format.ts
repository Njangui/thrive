/**
 * Extrait de `product-card.tsx`/`produits/[slug]/page.tsx` (dupliqué à
 * l'identique dans les deux, avant ce lot) — Lot K ajoute plusieurs
 * nouveaux endroits qui affichent un prix (services, promotions,
 * formulaire de réservation) : centralisé ici plutôt qu'une 3e/4e copie.
 * Comportement inchangé (FCFA en dur, cohérent avec `currency` par défaut
 * 'XAF' de `organizations` — pas de vraie internationalisation demandée
 * par aucun cahier à ce jour).
 */
export function formatPrice(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} FCFA`;
}
