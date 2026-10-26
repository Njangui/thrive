import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findPublishedPage } from "@/application/services/site-published-config";
import { BlockPage } from "@/app/_components/storefront/block-page";
import { requireStorefront, buildStorefrontMetadata } from "../_lib/storefront-page";

/**
 * Pages supplémentaires du site (C4) : `/<slug>`, créées dans l'éditeur de versions.
 *
 * Aucune collision possible : les routes statiques (`/produits`, `/contact`…) l'emportent
 * toujours sur cette route dynamique, et les slugs réservés sont refusés à la création
 * (RESERVED_PAGE_SLUGS, vérifié contre l'arborescence réelle par un test). Seule la version
 * PUBLIÉE est servie : un brouillon n'est jamais accessible au public. Slug inconnu = 404.
 */
type Params = { params: Promise<{ pageSlug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { pageSlug } = await params;
  const site = await requireStorefront();
  const page = await findPublishedPage(site.tenant.organizationId, pageSlug);
  if (!page) return {};
  return buildStorefrontMetadata({
    path: `/${page.slug}`,
    title: page.seo.title ?? page.title,
    description: page.seo.description,
    noIndex: page.seo.noindex === true,
    imageUrl: page.seo.ogImageUrl,
  });
}

export default async function SitePage({ params }: Params) {
  const { pageSlug } = await params;
  const site = await requireStorefront();
  const page = await findPublishedPage(site.tenant.organizationId, pageSlug);
  if (!page) notFound();
  return <BlockPage site={site} page={page} />;
}
