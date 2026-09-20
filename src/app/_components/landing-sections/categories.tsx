import Link from "next/link";
import type { StorefrontCategory } from "@/application/services/catalog-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS, categoryPath } from "@/application/config/storefront-routes";
import { sectionHeading, sectionSubheading } from "@/application/config/storefront-blueprint";
import { StorefrontImage } from "../storefront/storefront-image";
import { Section, SectionHeading } from "../storefront/storefront-ui";

/**
 * Vignettes de catégories. L'image vient de `categories.image_url` ou, à
 * défaut, de la photo d'un produit réel de la catégorie (voir
 * `listStorefrontCategories`) — jamais d'une banque d'images : le
 * visiteur doit voir ce qu'il trouvera derrière la vignette.
 *
 * La catégorie pointe désormais vers `/categories/<slug>`, une vraie page
 * indexable, au lieu de `/produits?category=<slug>`, un paramètre de
 * requête que Google traite au mieux comme une variante de la page
 * catalogue.
 */
export function CategoriesSection({
  categories,
  site,
}: {
  categories: StorefrontCategory[];
  site: StorefrontSite;
}) {
  if (categories.length === 0) return null;
  const { blueprint } = site;

  if (site.sector === "restaurant") {
    return (
      <Section className="restaurant-menu-section">
        <div className="restaurant-menu-intro">
          <p className="restaurant-kicker">NOTRE MENU</p>
          <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Des saveurs pour tous les goûts</h2>
          <p className="mt-3 max-w-sm text-sm leading-7 text-black/60">Découvrez notre carte pensée autour de produits frais et de recettes généreuses, préparées avec soin dans notre cuisine.</p>
          <Link href={STOREFRONT_PATHS.catalog} className="restaurant-outline-btn mt-6 inline-flex items-center">Voir toute la carte <span aria-hidden>→</span></Link>
        </div>
        <div className="restaurant-category-grid">
          {categories.slice(0, 4).map((category) => (
            <Link key={category.id} href={categoryPath(category.slug)} className="restaurant-category-card group">
              <div className="restaurant-category-image">
                <StorefrontImage src={category.imageUrl} alt={category.name} sizes="(min-width: 1024px) 20vw, 50vw" className="transition-transform duration-500 group-hover:scale-105" fallbackLabel="" />
              </div>
              <div className="restaurant-category-copy">
                <div>
                  <h3>{category.name}</h3>
                  <p>{category.productCount} {category.productCount > 1 ? blueprint.catalogItemLabelPlural : blueprint.catalogItemLabel}</p>
                </div>
                <span aria-hidden>Découvrir →</span>
              </div>
            </Link>
          ))}
        </div>
      </Section>
    );
  }

  return (
    <Section tone="muted">
      <SectionHeading
        title={sectionHeading(blueprint, "categories", "Nos catégories")}
        subtitle={sectionSubheading(blueprint, "categories")}
        action={categories.length > 5 ? { label: "Voir toutes les catégories", href: STOREFRONT_PATHS.categories } : undefined}
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {categories.slice(0, 10).map((category) => (
          <Link key={category.id} href={categoryPath(category.slug)} className="sf-card group overflow-hidden rounded-brand border border-black/[0.08] bg-white transition-all hover:border-brand/40 hover:shadow-md">
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/[0.03]">
              <StorefrontImage src={category.imageUrl} alt={category.name} sizes="(min-width: 1024px) 20vw, 50vw" className="transition-transform duration-300 group-hover:scale-[1.04]" fallbackLabel="" />
            </div>
            <div className="p-3">
              <p className="font-display text-sm font-semibold leading-snug">{category.name}</p>
              <p className="mt-0.5 text-xs text-black/50">{category.productCount} {category.productCount > 1 ? blueprint.catalogItemLabelPlural : blueprint.catalogItemLabel}</p>
            </div>
          </Link>
        ))}
      </div>
    </Section>
  );
}
