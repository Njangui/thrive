import type { StorefrontProduct } from "@/application/services/catalog-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { sectionHeading, sectionSubheading } from "@/application/config/storefront-blueprint";
import { ProductGrid } from "../storefront/product-card";
import { Section, SectionHeading } from "../storefront/storefront-ui";

/**
 * Section promotions. La maquette de référence place ici un compte à
 * rebours (« 02 j 14 h 37 min »). Il n'est PAS reproduit : le modèle de
 * données n'a aucune date de fin de promotion (`products.compare_at_price`
 * est un prix, pas une campagne datée). Un compte à rebours branché sur
 * une échéance inventée se réinitialiserait à chaque rechargement et
 * mentirait au client du commerçant — exactement le genre de faux signal
 * d'urgence que ce projet s'interdit. La fonctionnalité demande une table
 * de campagnes datées ; elle est listée comme telle dans le rapport.
 */
export function PromotionsSection({ products, site }: { products: StorefrontProduct[]; site: StorefrontSite }) {
  if (products.length === 0) return null;
  const { blueprint, tenant } = site;

  return (
    <Section>
      <SectionHeading
        title={sectionHeading(blueprint, "promotions", "Promotions en cours")}
        subtitle={sectionSubheading(blueprint, "promotions")}
        action={{ label: "Toutes les promotions", href: STOREFRONT_PATHS.promotions }}
      />
      <ProductGrid products={products} organizationId={tenant.organizationId} newBadgeLabel={blueprint.newBadgeLabel} />
    </Section>
  );
}
