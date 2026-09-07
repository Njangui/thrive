"use server";

import { trackEvent } from "@/application/services/analytics-service";

/**
 * Server Action appelée depuis un clic CTA sur la vitrine publique
 * (WhatsApp/Contact — master prompt §55, Lot H, Partie 2). Appelée par un
 * visiteur anonyme depuis une page publique, PAS depuis le dashboard
 * authentifié — donc aucune vérification `requireMembership()` ici (il n'y
 * a pas de session à vérifier). C'est précisément pour éviter d'écrire
 * `analytics_events` directement depuis le navigateur avec la clé anon
 * (RLS ne le permettrait de toute façon pas, voir 0023_analytics_events.sql)
 * que ce clic passe par une Server Action plutôt qu'un appel Supabase
 * client-side.
 *
 * `trackEvent` ne lève jamais (voir analytics-service.ts) — cette action
 * reste donc toujours silencieuse du point de vue du visiteur, qu'elle
 * réussisse ou non.
 */
export async function trackClickAction(organizationId: string, ctaId: string): Promise<void> {
  await trackEvent(organizationId, "cta_click", "cta", undefined, { ctaId });
}
