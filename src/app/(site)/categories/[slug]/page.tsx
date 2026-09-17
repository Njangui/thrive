import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { resolveRequestTenant, resolveRequestOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import {
  getStorefrontCategoryBySlug,
  listStorefrontProducts,
  countStorefrontProducts,
  listStorefrontCategories,
} from "@/application/services/catalog-service";
import { STOREFRONT_PATHS, categoryPath } from "@/application/config/storefront-routes";
import { ProductGrid } from "@/app/_components/storefront/product-card";
import {
  Container,
  EmptyState,
  Pagination,
  PageHeader,
  Breadcrumbs,
} from "@/app/_components/storefront/storefront-ui";
import { requireStorefront, buildStorefrontMetadata, buildBreadcrumbJsonLd } from "../../_lib/storefront-page";

const PAGE_SIZE = 24;

/**
 * Page dédiée par catégorie, avec sa propre URL indexable. Auparavant,
 * une catégorie n'était qu'un paramètre de requête sur le catalogue
 * (`/produits?category=x`) : aucun titre propre, aucune description,
 * aucune URL qu'un commerçant puisse partager pour « la page des
 * chaussures ». Pour une PME dont le référencement local est souvent la
 * seule acquisition, c'est la différence entre une page indexée et zéro.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await resolveRequestTenant();
  if (!tenant) return {};

  const category = await getStorefrontCategoryBySlug(tenant.organizationId, slug);
  if (!category) return {};

  return buildStorefrontMetadata({
    path: categoryPath(slug),
    title: category.name,
    description: `${category.productCount} article${category.productCount > 1 ? "s" : ""} dans la catégorie ${category.name} chez ${tenant.name}.`,
  });
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const site = await requireStorefront();
  const { tenant, blueprint } = site;

  const category = await getStorefrontCategoryBySlug(tenant.organizationId, slug);
  if (!category) notFound();

  const page = Math.max(1, Number(pageParam) || 1);

  const [products, totalCount, siblings, origin] = await Promise.all([
    listStorefrontProducts(tenant.organizationId, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      categoryId: category.id,
      sort: "featured",
    }),
    countStorefrontProducts(tenant.organizationId, { categoryId: category.id }),
    listStorefrontCategories(tenant.organizationId),
    resolveRequestOrigin(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const otherCategories = siblings.filter((item) => item.id !== category.id);

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(origin, [
    { label: "Accueil", href: "/" },
    { label: blueprint.headings.categories, href: STOREFRONT_PATHS.categories },
    { label: category.name, href: categoryPath(slug) },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <PageHeader
        eyebrow={blueprint.headings.categories}
        title={category.name}
        description={`${totalCount} ${totalCount > 1 ? blueprint.catalogItemLabelPlural : blueprint.catalogItemLabel} disponibles.`}
      >
        <Breadcrumbs
          items={[
            { label: "Accueil", href: "/" },
            { label: blueprint.headings.categories, href: STOREFRONT_PATHS.categories },
            { label: category.name },
          ]}
        />
      </PageHeader>

      <Container className="py-8 sm:py-12">
        {products.length === 0 ? (
          <EmptyState
            title="Cette catégorie est vide pour le moment"
            description={blueprint.emptyCatalogMessage}
            action={{ label: `Voir ${blueprint.catalogLabel.toLowerCase()}`, href: STOREFRONT_PATHS.catalog }}
          />
        ) : (
          <>
            <ProductGrid
              products={products}
              organizationId={tenant.organizationId}
              newBadgeLabel={blueprint.newBadgeLabel}
            />
            <Pagination
              page={page}
              totalPages={totalPages}
              buildHref={(target) => (target === 1 ? categoryPath(slug) : `${categoryPath(slug)}?page=${target}`)}
            />
          </>
        )}

        {otherCategories.length > 0 && (
          <nav aria-label="Autres catégories" className="mt-12 border-t border-black/[0.07] pt-8">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-black/50">
              Autres catégories
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {otherCategories.map((item) => (
                <li key={item.id}>
                  <Link
                    href={categoryPath(item.slug)}
                    className="inline-flex rounded-full border border-black/12 px-3.5 py-1.5 text-sm hover:border-brand hover:text-brand"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </Container>
    </>
  );
}
