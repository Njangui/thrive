import { env } from "@/lib/env";
import { trackEvent, type AnalyticsEventType } from "../analytics-service";
import { buildVisitorId, isBotUserAgent } from "../landing-analytics-service";

/**
 * C5 — `track()` : point d'entrée unique des événements de la vitrine
 * (vue de page, vue produit, clic WhatsApp), en première partie (Postgres),
 * sans cookie ni outil tiers.
 *
 * Façade MINCE au-dessus de `trackEvent` (qui ne lève jamais : une panne
 * d'analytique ne doit jamais gêner un visiteur). Elle ajoute :
 *  - un typage strict des types d'événements ;
 *  - l'empreinte anonyme `visitor` (HMAC IP + navigateur + jour, jamais l'IP) qui relie
 *    l'entrée de session (source / campagne UTM) à un clic WhatsApp du même visiteur
 *    le même jour — c'est ce qui rend l'attribution « pub → clic WhatsApp » possible.
 */
export function track(
  organizationId: string,
  type: AnalyticsEventType,
  options: { entityType?: string; entityId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  return trackEvent(organizationId, type, options.entityType, options.entityId, options.metadata ?? {});
}

/** Un `ctaId` désigne-t-il un bouton WhatsApp ? Convention existante : `whatsapp_product`, `home_product_whatsapp`… */
export function isWhatsAppCta(ctaId: string): boolean {
  return /whatsapp/i.test(ctaId);
}

/** Même formule que `recordStorefrontVisit` (jour UTC) : les deux empreintes doivent coïncider. */
export function visitorIdFor(organizationId: string, ip: string, userAgent: string, now = new Date()): string {
  return buildVisitorId(env.SUPABASE_SERVICE_ROLE_KEY, organizationId, ip, userAgent, now.toISOString().slice(0, 10));
}

/** Enregistre un clic WhatsApp (ignoré pour les robots). Ne lève jamais. */
export async function trackWhatsAppClick(organizationId: string, input: { ctaId: string; ip: string; userAgent: string }): Promise<void> {
  if (!isWhatsAppCta(input.ctaId) || isBotUserAgent(input.userAgent)) return;
  await track(organizationId, "whatsapp_click", {
    entityType: "cta",
    metadata: { ctaId: input.ctaId.slice(0, 80), visitor: visitorIdFor(organizationId, input.ip, input.userAgent) },
  });
}
