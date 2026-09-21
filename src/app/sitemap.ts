import type { MetadataRoute } from "next";
import {
  resolveRequestTenant,
  resolveRequestSurface,
  resolveRequestOrigin,
  resolveMarketingOrigin,
} from "@/infrastructure/tenant/resolve-request-tenant";
import { listStorefrontCategories } from "@/application/services/catalog-service";
import { listSitemapProducts, listSitemapServices } from "@/application/services/sitemap-service";
import { getStorefrontCapabilities } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS, categoryPath, productPath, servicePath } from "@/application/config/storefront-routes";
import { MARKETING_SITEMAP_ENTRIES } from "@/lib/request-surface";
import { latestIsoDate, toIsoDate } from "@/lib/seo";

/**
 * sitemap.xml par tenant.
 *
 * ÉVOLUTION (vitrine V2) : le sitemap ne déclarait que deux URL fixes
 * (accueil + /produits) plus les fiches produit. La vitrine étant devenue
 * un site multi-pages, il déclare désormais aussi les catégories, les
 * prestations et les pages éditoriales — MAIS uniquement celles qui
 * existent réellement pour ce tenant, via `getStorefrontCapabilities`.
 * Déclarer une URL qui répond 404 (une page « prestations » chez un
 * commerçant qui n'en a aucune) fait perdre du budget de crawl et abîme
 * la confiance du moteur dans le sitemap entier.
 *
 * `lastModified` : `products.updated_at` et `services.updated_at` existent
 * (colonne + trigger `set_updated_at`, migrations 0007/0008) — l'ancien
 * commentaire qui affirmait le contraire était faux. Les fiches et les
 * pages de liste (`/produits`, `/services`) les reprennent ; l'accueil, les
 * catégories et les pages éditoriales n'ont pas de date fiable et n'en
 * déclarent aucune plutôt que d'en inventer une (une `lastmod` fausse fait
 * ignorer tout le champ par Google).
 *
 * Trois cas, comme `robots.ts` (voir `lib/request-surface.ts`) : la
 * plateforme déclare ses pages marketing, un tenant déclare sa vitrine, un
 * hôte non reconnu ne déclare rien.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const surface = await resolveRequestSurface();

  if (surface === "marketing") {
    const marketingOrigin = resolveMarketingOrigin();
    return MARKETING_SITEMAP_ENTRIES.map((entry) => ({
      url: entry.path === "/" ? marketingOrigin : `${marketingOrigin}${entry.path}`,
      changeFrequency: entry.changeFrequency,
      priority: entry.priority,
    }));
  }

  if (surface !== "tenant") return [];

  const tenant = await resolveRequestTenant();
  if (!tenant) return [];

  const [origin, capabilities] = await Promise.all([resolveRequestOrigin(), getStorefrontCapabilities(tenant)]);

  // Les listes détaillées ne sont chargées que si la page parente est
  // déclarée : inutile de lire le catalogue d'un tenant qui n'a que des
  // prestations. Lectures légères (slug + date), voir sitemap-service.ts.
  const [products, categories, services] = await Promise.all([
    capabilities.hasProducts ? listSitemapProducts(tenant.organizationId) : Promise.resolve([]),
    capabilities.hasCategories ? listStorefrontCategories(tenant.organizationId) : Promise.resolve([]),
    capabilities.hasServices ? listSitemapServices(tenant.organizationId) : Promise.resolve([]),
  ]);

  const entries: MetadataRoute.Sitemap = [{ url: origin, changeFrequency: "weekly", priority: 1 }];

  const addPage = (
    path: string,
    priority: number,
    changeFrequency: "daily" | "weekly" | "monthly" = "weekly",
    lastModified?: string,
  ) => {
    entries.push({ url: `${origin}${path}`, changeFrequency, priority, ...(lastModified ? { lastModified } : {}) });
  };

  // Une page de liste change quand un de ses éléments change.
  if (capabilities.hasProducts) {
    addPage(STOREFRONT_PATHS.catalog, 0.9, "weekly", latestIsoDate(products.map((product) => product.updatedAt)));
  }
  if (capabilities.hasCategories) addPage(STOREFRONT_PATHS.categories, 0.7);
  if (capabilities.hasPromotions) addPage(STOREFRONT_PATHS.promotions, 0.7, "daily");
  if (capabilities.hasServices) {
    addPage(STOREFRONT_PATHS.services, 0.9, "weekly", latestIsoDate(services.map((service) => service.updatedAt)));
  }
  if (capabilities.hasGallery) addPage(STOREFRONT_PATHS.gallery, 0.5, "monthly");
  if (capabilities.hasFaq) addPage(STOREFRONT_PATHS.faq, 0.6, "monthly");
  if (tenant.description || capabilities.hasTestimonials || capabilities.hasTeam) {
    addPage(STOREFRONT_PATHS.about, 0.6, "monthly");
  }
  if (capabilities.hasContactDetails || capabilities.hasOpeningHours) {
    addPage(STOREFRONT_PATHS.contact, 0.7, "monthly");
  }
  if (capabilities.hasServices || capabilities.hasWhatsApp || tenant.phone || tenant.email) {
    addPage(STOREFRONT_PATHS.booking, 0.8, "monthly");
  }

  for (const category of categories) {
    entries.push({ url: `${origin}${categoryPath(category.slug)}`, changeFrequency: "weekly", priority: 0.6 });
  }
  for (const product of products) {
    const lastModified = toIsoDate(product.updatedAt);
    entries.push({
      url: `${origin}${productPath(product.slug)}`,
      changeFrequency: "weekly",
      priority: 0.6,
      ...(lastModified ? { lastModified } : {}),
    });
  }
  for (const service of services) {
    const lastModified = toIsoDate(service.updatedAt);
    entries.push({
      url: `${origin}${servicePath(service.slug)}`,
      changeFrequency: "weekly",
      priority: 0.6,
      ...(lastModified ? { lastModified } : {}),
    });
  }

  return entries;
}
