import type { Metadata } from "next";
import {
  listStorefrontProducts,
  countStorefrontProducts,
} from "@/application/services/catalog-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { ProductGrid } from "@/app/_components/storefront/product-card";
import { CountdownTimer } from "@/app/_components/storefront/countdown-timer";
import { Container, EmptyState, Pagination, PageHeader, Breadcrumbs } from "@/app/_components/storefront/storefront-ui";
import { requireStorefront, buildStorefrontMetadata } from "../_lib/storefront-page";

const PAGE_SIZE = 24;

export async function generateMetadata(): Promise<Metadata> {
  const site = await requireStorefront();
  return buildStorefrontMetadata({
    path: STOREFRONT_PATHS.promotions,
    title: site.blueprint.headings.promotions ?? "Promotions",
    description: site.blueprint.subheadings.promotions ?? null,
  });
}

export default async function PromotionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const site = await requireStorefront();
  const { tenant, blueprint } = site;

  const page = Math.max(1, Number(pageParam) || 1);

  const [products, totalCount] = await Promise.all([
    listStorefrontProducts(tenant.organizationId, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      promotionsOnly: true,
      sort: "recent",
    }),
    countStorefrontProducts(tenant.organizationId, { promotionsOnly: true }),
  ]);

  // Catalogue V2, itération 2 (0057) — échéance la plus proche parmi les
  // promotions affichées, pour la bannière ci-dessous. `promotionEndsAt`
  // est déjà `null` pour toute promotion expirée ou sans échéance (voir
  // catalog-service.ts::isPromotionCurrentlyOn) : ce tri ne considère donc
  // que des échéances réelles et encore actives.
  const soonestDeadline = products
    .map((p) => p.promotionEndsAt)
    .filter((d): d is string => Boolean(d))
    .sort()[0] ?? null;

  return (
    <>
      <PageHeader
        eyebrow={blueprint.eyebrow}
        title={blueprint.headings.promotions ?? "Promotions"}
        description={blueprint.subheadings.promotions ?? null}
      >
        <Breadcrumbs items={[{ label: "Accueil", href: "/" }, { label: blueprint.headings.promotions ?? "Promotions" }]} />
      </PageHeader>

      <Container className="py-8 sm:py-12">
        {soonestDeadline && (
          <div className="mb-8 flex flex-col items-center gap-4 rounded-brand border border-brand/20 bg-brand/5 p-6 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand">Offre à durée limitée</p>
              <p className="mt-1 text-sm text-black/60">
                Une promotion se termine bientôt — les articles concernés portent un compte à rebours ci-dessous.
              </p>
            </div>
            <CountdownTimer endsAt={soonestDeadline} variant="full" />
          </div>
        )}
        {products.length === 0 ? (
          <EmptyState
            title="Aucune promotion en cours"
            description="Repassez bientôt, ou parcourez l'ensemble de nos articles."
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
              totalPages={Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
              buildHref={(target) =>
                target === 1 ? STOREFRONT_PATHS.promotions : `${STOREFRONT_PATHS.promotions}?page=${target}`
              }
            />
          </>
        )}
      </Container>
    </>
  );
}
