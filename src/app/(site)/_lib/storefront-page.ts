import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveRequestTenant, resolveCanonicalOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { getStorefrontSite, type StorefrontSite } from "@/application/services/storefront-service";
import { resolveOrganizationSeo, buildSocialMetadata, toMetaDescription, withPageParam } from "@/lib/seo";

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
  // Aucun tenant = on est sur le domaine racine de Flexco. Ces routes
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
 * `canonical` est construit sur l'origine OFFICIELLE du tenant
 * (`resolveCanonicalOrigin` : son domaine custom principal s'il en a un,
 * sinon l'hôte visité), jamais sur `NEXT_PUBLIC_APP_URL` qui pointerait
 * vers le domaine de la plateforme.
 *
 * `page` : une liste paginée s'auto-référence. Avant, la canonique de
 * `/produits?page=3` pointait vers `/produits` : Google en déduisait que
 * les pages 2, 3… étaient de simples doublons de la première et n'avait
 * plus de raison d'en suivre les produits. Titre et description reçoivent
 * un suffixe « page N » pour que ces pages ne soient pas non plus des
 * doublons de titre. La page 1 n'a jamais de `?page=1`.
 *
 * `imageUrl` : image de partage propre à la page (photo de la prestation,
 * de la catégorie…) ; à défaut, celle de l'entreprise (`resolveOrganizationSeo`).
 */
export async function buildStorefrontMetadata({
  path,
  title,
  description,
  noIndex = false,
  page = 1,
  imageUrl,
}: {
  path: string;
  title: string;
  description?: string | null;
  noIndex?: boolean;
  page?: number;
  imageUrl?: string | null;
}): Promise<Metadata> {
  const tenant = await resolveRequestTenant();
  if (!tenant) return {};

  const origin = await resolveCanonicalOrigin();
  const seo = resolveOrganizationSeo(tenant);
  const fullTitle = `${title} — ${tenant.name}${page > 1 ? ` — page ${page}` : ""}`;
  const baseDescription = toMetaDescription(description) ?? seo.description;
  const resolvedDescription = page > 1 && baseDescription ? `${baseDescription} (page ${page})` : baseDescription;
  const canonical = `${origin}${withPageParam(path, page)}`;

  const ownImage = imageUrl?.trim() || undefined;

  return {
    title: fullTitle,
    description: resolvedDescription,
    alternates: { canonical },
    // `noIndex` sert les pages de RÉSULTATS filtrés (recherche, tri) et les
    // fiches retirées du catalogue : les laisser indexables produirait des
    // dizaines d'URL quasi identiques pour un même catalogue, ce que les
    // moteurs pénalisent.
    robots: noIndex ? { index: false, follow: true } : undefined,
    ...buildSocialMetadata({
      title: fullTitle,
      description: resolvedDescription,
      url: canonical,
      imageUrl: ownImage ?? seo.ogImageUrl,
      // Une image propre à la page (photo produit/prestation/catégorie) est carrée dans la vitrine.
      imageIsSquare: ownImage ? true : seo.ogImageIsSquare,
      siteName: tenant.name,
    }),
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
