import { notFound } from "next/navigation";
import Link from "next/link";
import { resolveRequestTenant } from "@/infrastructure/tenant/resolve-request-tenant";
import {
  listActiveProductsForStorefront,
  countActiveProducts,
  getCategoryBySlug,
} from "@/application/services/catalog-service";
import { ProductCard } from "../_components/product-card";
import { getTenantBrandingStyle, resolveTenantFontClassName } from "@/lib/tenant-branding";
import { getLandingConfig } from "@/application/services/landing-config-service";

// OPTIMISATION : cette page chargeait tout le catalogue actif en une
// requête, sans limite (voir le commentaire sur
// listActiveProductsForStorefront) — pagination simple par page= dans
// l'URL, même principe que `/dashboard/products`.
const PAGE_SIZE = 24;

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string }>;
}) {
  const { page: pageParam, category: categorySlug } = await searchParams;
  const tenant = await resolveRequestTenant();
  if (!tenant) notFound();

  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Lot K : lien "voir tout" depuis la section landing "categories" —
  // ?category=<slug> filtre le catalogue public sur une catégorie
  // précise plutôt que de renvoyer vers un catalogue générique non filtré
  // (voir RAPPORT_LOT_K.md, décision "categories").
  const category = categorySlug ? await getCategoryBySlug(tenant.organizationId, categorySlug) : null;

  // Couleurs/police de marque (Lot K) : cohérence visuelle avec la
  // landing page plutôt qu'un catalogue à l'apparence générique une fois
  // qu'un commerçant a personnalisé sa vitrine — voir
  // src/lib/tenant-branding.ts.
  const [products, totalCount, landingConfig] = await Promise.all([
    listActiveProductsForStorefront(tenant.organizationId, {
      limit: PAGE_SIZE,
      offset,
      categoryId: category?.id,
    }),
    countActiveProducts(tenant.organizationId, category?.id),
    getLandingConfig(tenant.organizationId, tenant.industry),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const categoryQuery = category && categorySlug ? `&category=${encodeURIComponent(categorySlug)}` : "";

  return (
    <main
      className={`mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 sm:py-16 ${resolveTenantFontClassName(landingConfig.fontChoice)}`}
      style={getTenantBrandingStyle(landingConfig)}
    >
      <header>
        <p className="font-display text-sm font-medium text-leaf">{tenant.name}</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">
          {category ? category.name : "Tous nos produits"}
        </h1>
        {category && (
          <Link href="/produits" className="mt-1 inline-block text-sm text-brand hover:underline">
            ← Voir tout le catalogue
          </Link>
        )}
      </header>

      {products.length === 0 ? (
        <p className="text-muted">
          Le catalogue est en cours de mise à jour — contactez-nous directement pour toute demande.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <p>
            Page {page} sur {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/produits?page=${page - 1}${categoryQuery}`}
                className="rounded-brand border border-ink/15 px-3 py-1.5 font-medium hover:border-ink/30"
              >
                Précédent
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/produits?page=${page + 1}${categoryQuery}`}
                className="rounded-brand border border-ink/15 px-3 py-1.5 font-medium hover:border-ink/30"
              >
                Suivant
              </Link>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
