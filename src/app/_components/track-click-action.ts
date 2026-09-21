"use server";

import { trackEvent } from "@/application/services/analytics-service";
import { resolveRequestTenant } from "@/infrastructure/tenant/resolve-request-tenant";
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";

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
export async function trackClickAction(_organizationId: string, ctaId: string): Promise<void> {
  const tenant = await resolveRequestTenant();
  if (!tenant) return;
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || headerList.get("x-real-ip") || "unknown";
  if ((await checkRateLimit("public_analytics", ip)) !== null) return;
  const safeCtaId = String(ctaId ?? "").slice(0, 80);
  if (!safeCtaId) return;
  // Never trust the organizationId supplied by the browser: the tenant is
  // resolved from the request hostname on the server.
  await trackEvent(tenant.organizationId, "cta_click", "cta", undefined, { ctaId: safeCtaId });
}
