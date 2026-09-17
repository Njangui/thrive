import type { MetadataRoute } from "next";
import { resolveRequestTenant, resolveRequestOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import {
  listActiveProductsForStorefront,
  listStorefrontCategories,
} from "@/application/services/catalog-service";
import { listActiveServicesForStorefront } from "@/application/services/landing-config-service";
import { getStorefrontCapabilities } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS, categoryPath, productPath, servicePath } from "@/application/config/storefront-routes";

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
 * Pas de `lastModified` : aucune colonne de date de modification fiable
 * n'existe sur `products` dans ce projet — plutôt qu'inventer une date,
 * on omet le champ.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tenant = await resolveRequestTenant();
  if (!tenant) return [];

  const [origin, capabilities] = await Promise.all([resolveRequestOrigin(), getStorefrontCapabilities(tenant)]);

  const entries: MetadataRoute.Sitemap = [{ url: origin, changeFrequency: "weekly", priority: 1 }];

  const addPage = (path: string, priority: number, changeFrequency: "daily" | "weekly" | "monthly" = "weekly") => {
    entries.push({ url: `${origin}${path}`, changeFrequency, priority });
  };

  if (capabilities.hasProducts) addPage(STOREFRONT_PATHS.catalog, 0.9);
  if (capabilities.hasCategories) addPage(STOREFRONT_PATHS.categories, 0.7);
  if (capabilities.hasPromotions) addPage(STOREFRONT_PATHS.promotions, 0.7, "daily");
  if (capabilities.hasServices) addPage(STOREFRONT_PATHS.services, 0.9);
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

  // Les listes détaillées ne sont chargées que si la page parente est
  // déclarée : inutile de lire tout le catalogue d'un tenant qui n'a que
  // des prestations.
  const [products, categories, services] = await Promise.all([
    capabilities.hasProducts ? listActiveProductsForStorefront(tenant.organizationId) : Promise.resolve([]),
    capabilities.hasCategories ? listStorefrontCategories(tenant.organizationId) : Promise.resolve([]),
    capabilities.hasServices ? listActiveServicesForStorefront(tenant.organizationId, 200) : Promise.resolve([]),
  ]);

  for (const category of categories) {
    entries.push({ url: `${origin}${categoryPath(category.slug)}`, changeFrequency: "weekly", priority: 0.6 });
  }
  for (const product of products) {
    if (!product.slug) continue;
    entries.push({ url: `${origin}${productPath(product.slug)}`, changeFrequency: "weekly", priority: 0.6 });
  }
  for (const service of services) {
    if (!service.slug) continue;
    entries.push({ url: `${origin}${servicePath(service.slug)}`, changeFrequency: "weekly", priority: 0.6 });
  }

  return entries;
}
