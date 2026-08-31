import type { MetadataRoute } from "next";
import { resolveRequestTenant, resolveRequestOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { listActiveProductsForStorefront } from "@/application/services/catalog-service";

/**
 * sitemap.xml par tenant (Lot H, Partie 1 — au-delà du strict minimum du
 * cahier, rien dans "Hors scope" ne l'exclut). Liste la landing + la page
 * catalogue + chaque produit ACTIF ayant un slug (mêmes critères que
 * `listActiveProductsForStorefront`, déjà utilisée par page.tsx — on ne
 * réimplémente pas le filtre "actif" ici).
 *
 * Pas de `lastModified` : aucune colonne `updated_at` fiable n'existe sur
 * `products` dans ce projet (voir docs/DATABASE.md) — plutôt que d'inventer
 * une date, on omet le champ (section 45 : ne jamais inventer de donnée).
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tenant = await resolveRequestTenant();
  if (!tenant) return [];

  const [origin, products] = await Promise.all([
    resolveRequestOrigin(),
    listActiveProductsForStorefront(tenant.organizationId),
  ]);

  const entries: MetadataRoute.Sitemap = [
    { url: origin, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/produits`, changeFrequency: "weekly", priority: 0.8 },
  ];

  for (const product of products) {
    if (!product.slug) continue;
    entries.push({
      url: `${origin}/produits/${product.slug}`,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  return entries;
}
