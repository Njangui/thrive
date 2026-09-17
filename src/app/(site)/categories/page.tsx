import type { Metadata } from "next";
import Link from "next/link";
import { listStorefrontCategories } from "@/application/services/catalog-service";
import { STOREFRONT_PATHS, categoryPath } from "@/application/config/storefront-routes";
import { StorefrontImage } from "@/app/_components/storefront/storefront-image";
import { Container, EmptyState, PageHeader, Breadcrumbs } from "@/app/_components/storefront/storefront-ui";
import { requireStorefront, buildStorefrontMetadata } from "../_lib/storefront-page";

export async function generateMetadata(): Promise<Metadata> {
  const site = await requireStorefront();
  return buildStorefrontMetadata({
    path: STOREFRONT_PATHS.categories,
    title: site.blueprint.headings.categories,
    description: site.blueprint.subheadings.categories ?? null,
  });
}

export default async function CategoriesPage() {
  const site = await requireStorefront();
  const { tenant, blueprint } = site;
  const categories = await listStorefrontCategories(tenant.organizationId);

  return (
    <>
      <PageHeader
        eyebrow={blueprint.eyebrow}
        title={blueprint.headings.categories}
        description={blueprint.subheadings.categories ?? null}
      >
        <Breadcrumbs items={[{ label: "Accueil", href: "/" }, { label: blueprint.headings.categories }]} />
      </PageHeader>

      <Container className="py-8 sm:py-12">
        {categories.length === 0 ? (
          <EmptyState
            title="Aucune catégorie pour le moment"
            description={blueprint.emptyCatalogMessage}
            action={{ label: `Voir ${blueprint.catalogLabel.toLowerCase()}`, href: STOREFRONT_PATHS.catalog }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={categoryPath(category.slug)}
                className="sf-card group overflow-hidden rounded-brand border border-black/[0.08] bg-white transition-all hover:border-brand/40 hover:shadow-md"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/[0.03]">
                  <StorefrontImage
                    src={category.imageUrl}
                    alt={category.name}
                    sizes="(min-width: 1024px) 25vw, 50vw"
                    className="transition-transform duration-300 group-hover:scale-[1.04]"
                    fallbackLabel=""
                  />
                </div>
                <div className="p-4">
                  <p className="font-display text-sm font-semibold">{category.name}</p>
                  <p className="mt-0.5 text-xs text-black/50">
                    {category.productCount}{" "}
                    {category.productCount > 1 ? blueprint.catalogItemLabelPlural : blueprint.catalogItemLabel}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Container>
    </>
  );
}
