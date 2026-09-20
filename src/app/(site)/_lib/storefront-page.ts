import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveRequestTenant, resolveRequestOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { getStorefrontSite, type StorefrontSite } from "@/application/services/storefront-service";
import { resolveOrganizationSeo } from "@/lib/seo";

/**
 * Socle commun à toutes les pages du site vitrine.
 *
 * Sans lui, chaque page répéterait : résoudre le tenant, gérer le cas
 * « domaine racine » (où ces URL n'ont aucun sens et doivent répondre
 * 404), charger le modèle de site, puis reconstruire ses métadonnées. Le
 * risque n'est pas la répétition mais la DIVERGENCE — une page qui
 * oublierait le `notFound()` exposerait une URL de vitrine sur le domaine
 * de la plateforme.
 */
export async function requireStorefront(): Promise<StorefrontSite> {
  const tenant = await resolveRequestTenant();
  // Aucun tenant = on est sur le domaine racine de CRESYVA. Ces routes
  // (catalogue, catégories, prestations…) n'y existent pas : 404 franc
  // plutôt qu'une page à moitié rendue sans données.
  if (!tenant) notFound();
  return getStorefrontSite(tenant);
}

/**
 * Métadonnées d'une page intérieure du site. Le titre suit le format
 * « Page — Entreprise », jamais un titre nu : dans un onglet ou un
 * résultat Google, « Contact » seul n'identifie aucune entreprise.
 *
 * `canonical` est construit sur l'origine RÉELLE de la requête
 * (sous-domaine ou domaine custom du tenant), jamais sur
 * `NEXT_PUBLIC_APP_URL` qui pointerait vers le domaine de la plateforme.
 */
export async function buildStorefrontMetadata({
  path,
  title,
  description,
  noIndex = false,
}: {
  path: string;
  title: string;
  description?: string | null;
  noIndex?: boolean;
}): Promise<Metadata> {
  const tenant = await resolveRequestTenant();
  if (!tenant) return {};

  const origin = await resolveRequestOrigin();
  const seo = resolveOrganizationSeo(tenant);
  const fullTitle = `${title} — ${tenant.name}`;
  const resolvedDescription = description?.trim() || seo.description;
  const canonical = `${origin}${path}`;

  return {
    title: fullTitle,
    description: resolvedDescription,
    alternates: { canonical },
    // `noIndex` sert les pages de RÉSULTATS filtrés (recherche, tri) :
    // les laisser indexables produirait des dizaines d'URL quasi
    // identiques pour un même catalogue, ce que les moteurs pénalisent.
    robots: noIndex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: "website",
      title: fullTitle,
      description: resolvedDescription,
      url: canonical,
      images: seo.ogImageUrl ? [seo.ogImageUrl] : undefined,
    },
    twitter: {
      card: seo.ogImageUrl ? "summary_large_image" : "summary",
      title: fullTitle,
      description: resolvedDescription,
      images: seo.ogImageUrl ? [seo.ogImageUrl] : undefined,
    },
    icons: tenant.faviconUrl ? { icon: tenant.faviconUrl } : undefined,
  };
}

/** Fil d'Ariane structuré (schema.org) — permet à Google d'afficher le chemin au lieu de l'URL brute. */
export function buildBreadcrumbJsonLd(origin: string, items: { label: string; href: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: `${origin}${item.href}`,
    })),
  };
}
