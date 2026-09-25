import type { MetadataRoute } from "next";
import {
  resolveRequestSurface,
  resolveRequestOrigin,
  resolveMarketingOrigin,
} from "@/infrastructure/tenant/resolve-request-tenant";
import { CRAWL_BLOCKED_PATHS, PLATFORM_ONLY_PATHS } from "@/lib/request-surface";

/**
 * robots.txt selon le « site » qui répond (voir `lib/request-surface.ts`).
 * `x-tenant-slug`/`x-tenant-custom-domain` sont propagés pour cette route
 * par `src/proxy.ts` (son matcher n'exclut que
 * `_next/static|_next/image|favicon.ico`).
 *
 *  - `marketing`    : la landing flexco , /tarifs, /devenir-affilie… sont
 *                     ouverts à l'exploration. Avant l'audit SEO de
 *                     sept. 2026, ce cas retombait dans « pas de tenant »
 *                     et renvoyait `Disallow: /` : toute la plateforme
 *                     était invisible pour Google.
 *  - `tenant`       : vitrine du commerçant ouverte, SAUF les pages de la
 *                     plateforme que le routage par hôte expose aussi sous
 *                     son domaine (`/tarifs`, `/cgu`… — du contenu dupliqué).
 *  - `unrecognized` : sous-domaine inconnu, tenant suspendu, prévisualisation
 *                     Vercel : rien à indexer.
 *
 * `/login` et `/reset-password` ne sont volontairement PAS bloqués ici : ils
 * portent un `noindex` (en-tête `X-Robots-Tag`, voir next.config.mjs) que
 * Google ne peut lire que s'il a le droit de les explorer.
 */
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const surface = await resolveRequestSurface();

  if (surface === "unrecognized") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  if (surface === "marketing") {
    return {
      rules: { userAgent: "*", allow: "/", disallow: [...CRAWL_BLOCKED_PATHS] },
      sitemap: `${resolveMarketingOrigin()}/sitemap.xml`,
    };
  }

  // `resolveRequestOrigin` (hôte visité) et non l'origine canonique : un
  // sitemap ne peut lister que des URL de l'hôte qui le sert.
  const origin = await resolveRequestOrigin();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...CRAWL_BLOCKED_PATHS, ...PLATFORM_ONLY_PATHS],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
