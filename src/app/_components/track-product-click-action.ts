"use server";

import { trackEvent } from "@/application/services/analytics-service";

/**
 * Server Action appelée depuis le clic sur une carte produit de la
 * vitrine publique (`ProductCard`) — même pattern que
 * `track-click-action.ts` (Lot H) pour les CTA WhatsApp/Contact, repris
 * ici pour `product_click` (périmètre hérité du Lot O, jamais câblé
 * avant cette vague — la clé existait déjà dans l'énum SQL
 * `analytics_events` sans jamais être émise).
 *
 * `trackEvent` ne lève jamais — cette action reste silencieuse du point
 * de vue du visiteur, qu'elle réussisse ou non.
 */
export async function trackProductClickAction(organizationId: string, productId: string): Promise<void> {
  await trackEvent(organizationId, "product_click", "product", productId);
}
