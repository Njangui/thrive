import type { StorefrontProduct } from "@/application/services/catalog-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { sectionHeading, sectionSubheading } from "@/application/config/storefront-blueprint";
import { ProductGrid } from "../storefront/product-card";
import { Section, SectionHeading, EmptyState } from "../storefront/storefront-ui";

export function ProductsSection({ products, site }: { products: StorefrontProduct[]; site: StorefrontSite }) {
  const { blueprint, tenant } = site;

  return (
    <Section>
      <SectionHeading
        title={sectionHeading(blueprint, "products", "Nos produits")}
        subtitle={sectionSubheading(blueprint, "products")}
        action={products.length > 0 ? { label: `Voir ${blueprint.catalogLabel.toLowerCase()}`, href: STOREFRONT_PATHS.catalog } : undefined}
      />
      {products.length === 0 ? (
        // La section n'est plus muette quand le catalogue est vide : un
        // `return null` laissait un titre de secteur sans contenu et, sur
        // un tenant neuf, une page d'accueil quasiment blanche sans que le
        // commerçant comprenne pourquoi.
        <EmptyState
          title={`Aucun ${blueprint.catalogItemLabel} publié pour le moment`}
          description={blueprint.emptyCatalogMessage}
          action={site.capabilities.hasWhatsApp ? undefined : undefined}
        />
      ) : (
        <ProductGrid
          products={products}
          organizationId={tenant.organizationId}
          newBadgeLabel={blueprint.newBadgeLabel}
        />
      )}
    </Section>
  );
}
