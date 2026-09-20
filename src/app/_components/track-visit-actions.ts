"use server";

import { headers } from "next/headers";
import { resolveRequestTenant } from "@/infrastructure/tenant/resolve-request-tenant";
import { isBotUserAgent, recordStorefrontVisit } from "@/application/services/landing-analytics-service";
import { trackEvent } from "@/application/services/analytics-service";

/**
 * Actions publiques d'analytique de la vitrine (appelées par le navigateur
 * du visiteur). Le tenant est résolu CÔTÉ SERVEUR à partir de l'hôte de la
 * requête — jamais depuis un identifiant fourni par le navigateur — et
 * aucune de ces actions ne lève : une panne d'analytique ne doit jamais
 * gêner un visiteur.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function trackPageViewAction(input: {
  path: string;
  entry: boolean;
  referrer: string;
  search: string;
}): Promise<void> {
  try {
    const tenant = await resolveRequestTenant();
    if (!tenant) return;
    const h = await headers();
    const forwardedFor = h.get("x-forwarded-for") ?? "";

    await recordStorefrontVisit(tenant.organizationId, {
      path: String(input.path ?? "/").slice(0, 200),
      entry: Boolean(input.entry),
      referrer: String(input.referrer ?? "").slice(0, 500),
      search: String(input.search ?? "").slice(0, 500),
      userAgent: h.get("user-agent") ?? "",
      ip: forwardedFor.split(",")[0]?.trim() || h.get("x-real-ip") || "",
      country: h.get("x-vercel-ip-country"),
      ownHost: h.get("host"),
    });
  } catch (error) {
    console.warn("[analytics] page_view non enregistrée:", error);
  }
}

/** Première lecture d'une vidéo du catalogue sur la vitrine (voir storefront-video.tsx). */
export async function trackVideoPlayAction(videoId: string): Promise<void> {
  try {
    if (!UUID.test(videoId)) return;
    const tenant = await resolveRequestTenant();
    if (!tenant) return;
    const h = await headers();
    if (isBotUserAgent(h.get("user-agent") ?? "")) return;
    await trackEvent(tenant.organizationId, "video_play", "video", videoId, {});
  } catch (error) {
    console.warn("[analytics] video_play non enregistrée:", error);
  }
}
