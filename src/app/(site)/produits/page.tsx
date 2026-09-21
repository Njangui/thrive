import { listProductIdsWithActiveVideo } from "@/application/services/catalog-video-service";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parsePageParam } from "@/lib/seo";
import {
  listStorefrontProducts,
  countStorefrontProducts,
  listStorefrontCategories,
  getStorefrontCategoryBySlug,
  type StorefrontProductSort,
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
import { requireStorefront, buildStorefrontMetadata } from "../_lib/storefront-page";

const PAGE_SIZE = 24;

const SORT_OPTIONS: { value: StorefrontProductSort; label: string }[] = [
  { value: "featured", label: "Mis en avant" },
  { value: "recent", label: "Nouveautés" },
  { value: "price_asc", label: "Prix croissant" },
  { value: "price_desc", label: "Prix décroissant" },
  { value: "name", label: "Nom (A-Z)" },
];

function parseSort(value: string | undefined): StorefrontProductSort {
  return SORT_OPTIONS.some((option) => option.value === value) ? (value as StorefrontProductSort) : "featured";
}

interface CatalogSearchParams {
  page?: string;
  category?: string;
  q?: string;
  tri?: string;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<CatalogSearchParams>;
}): Promise<Metadata> {
  const { q, category, tri, page } = await searchParams;
  const site = await requireStorefront();

  return buildStorefrontMetadata({
    path: STOREFRONT_PATHS.catalog,
    title: q ? `Recherche « ${q} »` : site.blueprint.catalogLabel,
    description: site.blueprint.subheadings.products ?? null,
    // Les pages 2, 3… du catalogue complet sont indexables et
    // s'auto-référencent (voir `buildStorefrontMetadata`).
    page: parsePageParam(page),
    // Une page filtrée/triée/recherchée n'est qu'une vue du même
    // catalogue : l'indexer créerait des dizaines d'URL en doublon.
    noIndex: Boolean(q || tri || category),
  });
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<CatalogSearchParams>;
}) {
  const { page: pageParam, category: categorySlug, q, tri } = await searchParams;
  const site = await requireStorefront();
  const { tenant, blueprint } = site;

  const page = parsePageParam(pageParam);
  const sort = parseSort(tri);
  const search = q?.trim() || undefined;

  const category = categorySlug ? await getStorefrontCategoryBySlug(tenant.organizationId, categorySlug) : null;

  const [products, totalCount, categories, productIdsWithVideo] = await Promise.all([
    listStorefrontProducts(tenant.organizationId, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      categoryId: category?.id,
      search,
      sort,
    }),
    countStorefrontProducts(tenant.organizationId, { categoryId: category?.id, search }),
    listStorefrontCategories(tenant.organizationId),
    listProductIdsWithActiveVideo(tenant.organizationId),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Une page au-delà de la dernière n'existe pas : 404 franc plutôt qu'une
  // liste vide en 200 (soft 404, que Google écarte de l'index en le signalant).
  if (page > totalPages) notFound();

  // Conserve les filtres actifs d'une page à l'autre : sans ça, cliquer
  // « Suivant » sur une recherche filtrée renvoie au catalogue complet.
  const buildHref = (overrides: Partial<CatalogSearchParams>) => {
    const params = new URLSearchParams();
    const next = { page: String(page), category: categorySlug, q: search, tri, ...overrides };
    if (next.q) params.set("q", next.q);
    if (next.category) params.set("category", next.category);
    if (next.tri && next.tri !== "featured") params.set("tri", next.tri);
    if (next.page && next.page !== "1") params.set("page", next.page);
    const query = params.toString();
    return query ? `${STOREFRONT_PATHS.catalog}?${query}` : STOREFRONT_PATHS.catalog;
  };

  return (
    <>
      <PageHeader
        eyebrow={blueprint.eyebrow}
        title={search ? `Recherche : « ${search} »` : category ? category.name : blueprint.catalogLabel}
        description={
          search
            ? `${totalCount} résultat${totalCount > 1 ? "s" : ""} dans ${blueprint.catalogLabel.toLowerCase()}.`
            : blueprint.subheadings.products ?? null
        }
      >
        <Breadcrumbs
          items={[
            { label: "Accueil", href: "/" },
            ...(category
              ? [{ label: blueprint.catalogLabel, href: STOREFRONT_PATHS.catalog }, { label: category.name }]
              : [{ label: blueprint.catalogLabel }]),
          ]}
        />
      </PageHeader>

      <Container className="py-8 sm:py-10">
        {/* Filtres en liens `<a>` et formulaire GET : chaque état du
            catalogue a sa propre URL, partageable et fonctionnelle sans
            JavaScript — indispensable sur une connexion mobile faible. */}
        {(categories.length > 0 || totalCount > 0) && (
          <div className="mb-6 flex flex-col gap-4 border-b border-black/[0.07] pb-5 lg:flex-row lg:items-center lg:justify-between">
            {categories.length > 0 && (
              <nav aria-label="Filtrer par catégorie" className="flex flex-wrap gap-2">
                <Link
                  href={buildHref({ category: undefined, page: "1" })}
                  aria-current={!category ? "true" : undefined}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                    !category ? "border-brand bg-brand text-white" : "border-black/12 hover:border-brand hover:text-brand"
                  }`}
                >
                  Tout
                </Link>
                {categories.map((item) => (
                  <Link
                    key={item.id}
                    href={buildHref({ category: item.slug, page: "1" })}
                    aria-current={category?.id === item.id ? "true" : undefined}
                    className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                      category?.id === item.id
                        ? "border-brand bg-brand text-white"
                        : "border-black/12 hover:border-brand hover:text-brand"
                    }`}
                  >
                    {item.name}
                    <span className="ml-1.5 text-xs opacity-60">{item.productCount}</span>
                  </Link>
                ))}
              </nav>
            )}

            <form method="get" action={STOREFRONT_PATHS.catalog} className="flex shrink-0 items-center gap-2">
              {search && <input type="hidden" name="q" value={search} />}
              {categorySlug && <input type="hidden" name="category" value={categorySlug} />}
              <label htmlFor="tri" className="text-sm text-black/55">
                Trier
              </label>
              <select
                id="tri"
                name="tri"
                defaultValue={sort}
                className="h-10 rounded-brand border border-black/12 bg-white px-3 text-sm outline-hidden focus:border-brand"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {/* Repli sans JavaScript : le `<select>` seul ne soumet rien. */}
              <button type="submit" className="sf-btn-outline h-10 px-3 text-sm">
                OK
              </button>
            </form>
          </div>
        )}

        {products.length === 0 ? (
          <EmptyState
            title={search ? "Aucun résultat pour cette recherche" : `Aucun ${blueprint.catalogItemLabel} disponible`}
            description={search ? "Essayez un autre mot, ou parcourez les catégories." : blueprint.emptyCatalogMessage}
            action={search || category ? { label: `Voir tout ${blueprint.catalogLabel.toLowerCase()}`, href: STOREFRONT_PATHS.catalog } : undefined}
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-black/50">
              {totalCount} {totalCount > 1 ? blueprint.catalogItemLabelPlural : blueprint.catalogItemLabel}
              {category ? ` dans « ${category.name} »` : ""}
            </p>
            <ProductGrid
              products={products}
              organizationId={tenant.organizationId}
              productIdsWithVideo={[...productIdsWithVideo]}
              newBadgeLabel={blueprint.newBadgeLabel}
            />
            <Pagination page={page} totalPages={totalPages} buildHref={(target) => buildHref({ page: String(target) })} />
          </>
        )}

        {category && (
          <p className="mt-8 text-sm">
            <Link href={categoryPath(category.slug)} className="font-semibold text-brand hover:underline">
              Voir la page « {category.name} »
            </Link>
          </p>
        )}
      </Container>
    </>
  );
}
