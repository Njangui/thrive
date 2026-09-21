"use server";

import { trackEvent } from "@/application/services/analytics-service";
import { resolveRequestTenant } from "@/infrastructure/tenant/resolve-request-tenant";
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";

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
export async function trackProductClickAction(_organizationId: string, productId: string): Promise<void> {
  const tenant = await resolveRequestTenant();
  if (!tenant) return;
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || headerList.get("x-real-ip") || "unknown";
  if ((await checkRateLimit("public_analytics", ip)) !== null) return;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(productId)) return;
  await trackEvent(tenant.organizationId, "product_click", "product", productId);
}
