import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";

export type CtaTarget = "catalog" | "booking" | "contact" | "promotions" | "services" | "gallery";

/**
 * Cible d'un bouton d'appel à l'action -> page qui existe RÉELLEMENT pour ce
 * tenant, ou `null`. On ne rend jamais un bouton dont la destination
 * n'existe pas (règle constante de la vitrine).
 *
 * Extrait de `hero.tsx` pour être partagé entre le hero générique et le
 * template restaurant — les deux doivent résoudre leurs CTA exactement de la
 * même façon, sans quoi la même configuration du commerçant produirait deux
 * comportements différents selon la composition affichée.
 */
export function resolveCtaTarget(target: CtaTarget, site: StorefrontSite): string | null {
  const { capabilities } = site;
  switch (target) {
    case "catalog":
      return capabilities.hasProducts ? STOREFRONT_PATHS.catalog : null;
    case "booking":
      return capabilities.bookingEnabled && (capabilities.hasServices || capabilities.hasWhatsApp) ? STOREFRONT_PATHS.booking : null;
    case "promotions":
      return capabilities.hasPromotions ? STOREFRONT_PATHS.promotions : null;
    case "services":
      return capabilities.hasServices ? STOREFRONT_PATHS.services : null;
    case "gallery":
      return capabilities.hasGallery ? STOREFRONT_PATHS.gallery : null;
    case "contact":
      return capabilities.hasContactDetails || capabilities.hasOpeningHours ? STOREFRONT_PATHS.contact : null;
    default:
      return null;
  }
}
