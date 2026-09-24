import type { Metadata } from "next";
import { resolveRequestSurface, resolveMarketingOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { buildSocialMetadata } from "@/lib/seo";

/** Nom de la plateforme, pour `og:site_name` et les données structurées de la landing. */
export const PLATFORM_NAME = "tokoo ";

/** Image de partage de la landing marketing (1200×630, < 300 Ko : WhatsApp ignore les images plus lourdes). */
export const MARKETING_OG_IMAGE_PATH = "/images/og-tokoo .png";

/**
 * Métadonnées d'une page de la PLATEFORME (landing, /tarifs, /devenir-affilie,
 * pages légales, /signup) — pendant de `buildStorefrontMetadata` pour la
 * vitrine d'un tenant.
 *
 * Ces routes existent aussi sous le domaine de CHAQUE commerçant (le routage
 * par hôte ne les distingue pas : `boutique.exemple.com/tarifs` sert la page
 * tarifs de tokoo ). Sous un hôte qui n'est pas le domaine racine de la
 * plateforme, la page est donc `noindex` : sinon le contenu de la plateforme
 * serait dupliqué, sous le nom de domaine de chaque boutique. Dans tous les
 * cas la canonique pointe vers la plateforme.
 */
export async function buildMarketingMetadata({
  path,
  title,
  description,
  noIndex = false,
}: {
  path: string;
  title: string;
  description?: string;
  noIndex?: boolean;
}): Promise<Metadata> {
  const surface = await resolveRequestSurface();
  const origin = resolveMarketingOrigin();
  const canonical = path === "/" ? origin : `${origin}${path}`;
  const indexable = surface === "marketing" && !noIndex;

  return {
    title,
    description,
    alternates: { canonical },
    robots: indexable ? undefined : { index: false, follow: true },
    ...buildSocialMetadata({
      title,
      description,
      url: canonical,
      imageUrl: `${origin}${MARKETING_OG_IMAGE_PATH}`,
      siteName: PLATFORM_NAME,
    }),
  };
}
