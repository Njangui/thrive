import type { StorefrontProduct } from "@/application/services/catalog-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { sectionHeading, sectionSubheading } from "@/application/config/storefront-blueprint";
import { ProductGrid } from "../storefront/product-card";
import { CountdownTimer } from "../storefront/countdown-timer";
import { Section, SectionHeading } from "../storefront/storefront-ui";

/**
 * Section promotions. Une session précédente avait délibérément renoncé au
 * compte à rebours de la maquette de référence : le modèle de données
 * n'avait qu'un prix barré (`products.compare_at_price`), jamais de date
 * de fin — un compte à rebours branché sur une échéance inventée se
 * serait réinitialisé à chaque rechargement et aurait menti au client du
 * commerçant. Catalogue V2, itération 2 (0057) ajoute cette donnée réelle
 * (`products.promotion_ends_at`, optionnelle) ; le compte à rebours
 * ci-dessous n'affiche donc QUE des échéances que le commerçant a
 * explicitement configurées, jamais une simulée.
 */
export function PromotionsSection({ products, site }: { products: StorefrontProduct[]; site: StorefrontSite }) {
  if (products.length === 0) return null;
  const { blueprint, tenant } = site;

  const soonestDeadline = products
    .map((p) => p.promotionEndsAt)
    .filter((d): d is string => Boolean(d))
    .sort()[0] ?? null;

  return (
    <Section>
      <SectionHeading
        title={sectionHeading(blueprint, "promotions", "Promotions en cours")}
        subtitle={sectionSubheading(blueprint, "promotions")}
        action={{ label: "Toutes les promotions", href: STOREFRONT_PATHS.promotions }}
      />
      {soonestDeadline && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-brand border border-brand/20 bg-brand/5 px-5 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-brand">Se termine dans</span>
          <CountdownTimer endsAt={soonestDeadline} variant="compact" />
        </div>
      )}
      <ProductGrid products={products} organizationId={tenant.organizationId} newBadgeLabel={blueprint.newBadgeLabel} />
    </Section>
  );
}
