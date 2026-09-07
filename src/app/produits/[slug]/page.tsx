import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  resolveRequestTenant,
  resolveRequestOrigin,
  buildWhatsAppLink,
} from "@/infrastructure/tenant/resolve-request-tenant";
import { getProductBySlug } from "@/application/services/catalog-service";
import { trackEvent } from "@/application/services/analytics-service";
import { resolveProductSeo, buildProductJsonLd, type ProductJsonLdAvailability } from "@/lib/seo";
import { TrackedCtaLink } from "@/app/_components/tracked-cta-link";
import { formatPrice } from "@/lib/format";
import { getTenantBrandingStyle, resolveTenantFontClassName } from "@/lib/tenant-branding";
import { getLandingConfig } from "@/application/services/landing-config-service";

const STATUS_LABELS: Record<string, { label: string; available: boolean }> = {
  active: { label: "Disponible", available: true },
  out_of_stock: { label: "Rupture de stock", available: false },
  draft: { label: "Bientôt disponible", available: false },
  inactive: { label: "Indisponible", available: false },
};

/** Section 18 (Lot H) -> disponibilité schema.org, seulement pour un produit actif (voir plus bas). */
const JSON_LD_AVAILABILITY: Record<string, ProductJsonLdAvailability> = {
  active: "InStock",
  out_of_stock: "OutOfStock",
};

/**
 * Lot H, Partie 1 — title/description/Open Graph/Twitter Card via
 * `src/lib/seo.ts::resolveProductSeo` : repli produit -> organisation ->
 * nom de l'entreprise, jamais de balise vide (critère d'acceptation Lot H).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await resolveRequestTenant();
  if (!tenant) return {};

  const product = await getProductBySlug(tenant.organizationId, slug);
  if (!product) return {};

  const origin = await resolveRequestOrigin();
  const canonicalUrl = `${origin}/produits/${slug}`;
  const seo = resolveProductSeo({
    productName: product.name,
    productSeoTitle: product.seoTitle,
    productSeoDescription: product.seoDescription,
    productDescription: product.description,
    productImageUrl: product.images[0],
    organization: tenant,
  });

  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "website",
      title: seo.title,
      description: seo.description,
      url: canonicalUrl,
      images: seo.ogImageUrl ? [seo.ogImageUrl] : undefined,
    },
    twitter: {
      card: seo.ogImageUrl ? "summary_large_image" : "summary",
      title: seo.title,
      description: seo.description,
      images: seo.ogImageUrl ? [seo.ogImageUrl] : undefined,
    },
    icons: tenant.faviconUrl ? { icon: tenant.faviconUrl } : undefined,
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await resolveRequestTenant();
  if (!tenant) notFound();

  const product = await getProductBySlug(tenant.organizationId, slug);
  if (!product) notFound();

  // Lot H, Partie 2 (master prompt §55) — best-effort, ne fait jamais
  // échouer le rendu si l'insert échoue (voir analytics-service.ts).
  // Démarré avant de calculer le reste, `await`é juste avant de rendre.
  const trackProductView = trackEvent(tenant.organizationId, "product_view", "product", product.id);

  const statusInfo = STATUS_LABELS[product.status] ?? { label: product.status, available: false };
  const hasPromo = product.compareAtPrice !== null && product.compareAtPrice > product.unitPrice;

  const whatsappHref = tenant.whatsappNumber
    ? buildWhatsAppLink(
        tenant.whatsappNumber,
        `Bonjour, je suis intéressé(e) par "${product.name}" (${formatPrice(product.unitPrice)}).`,
      )
    : null;

  // JSON-LD Product/Offer (Lot H, section 18) — uniquement pour un produit
  // ACTIF : on ne fait pas la promotion structurée auprès de Google d'un
  // produit draft/inactif/en rupture retiré volontairement, même si la
  // page reste consultable par un lien direct déjà partagé (section 40).
  const jsonLdAvailability = JSON_LD_AVAILABILITY[product.status];
  const origin = await resolveRequestOrigin();
  // Lot K : couleurs/police de marque, même wrapper que /produits et la
  // landing page (cohérence visuelle de la vitrine publique).
  const landingConfig = await getLandingConfig(tenant.organizationId, tenant.industry);
  const jsonLd = jsonLdAvailability
    ? buildProductJsonLd({
        name: product.name,
        description: product.description,
        images: product.images,
        url: `${origin}/produits/${slug}`,
        unitPrice: product.unitPrice,
        currency: tenant.currency,
        availability: jsonLdAvailability,
      })
    : null;

  await trackProductView;

  return (
    <main
      className={`mx-auto flex max-w-2xl flex-col gap-6 px-5 py-10 sm:py-16 ${resolveTenantFontClassName(landingConfig.fontChoice)}`}
      style={getTenantBrandingStyle(landingConfig)}
    >
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}

      {product.images.length > 0 ? (
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.images[0]}
            alt={product.name}
            className="aspect-square w-full rounded-lg border border-ink/10 object-cover"
          />
          {product.images.length > 1 && (
            <div className="grid grid-cols-4 gap-2">
              {product.images.slice(1, 5).map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt={product.name}
                  className="aspect-square w-full rounded border border-ink/10 object-cover"
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-ink/20 text-sm text-muted">
          Aucune photo pour ce produit
        </div>
      )}

      <div>
        {product.categoryName && (
          <span className="text-xs uppercase tracking-wide text-muted">{product.categoryName}</span>
        )}
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">{product.name}</h1>

        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-display text-xl font-semibold text-leaf">
            {formatPrice(product.unitPrice)}
          </span>
          {hasPromo && (
            <span className="text-sm text-muted line-through">{formatPrice(product.compareAtPrice!)}</span>
          )}
          {hasPromo && (
            <span className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-medium text-clay">Promo</span>
          )}
        </div>

        <span
          className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
            statusInfo.available ? "bg-leaf/10 text-leaf" : "bg-ink/10 text-muted"
          }`}
        >
          {statusInfo.label}
        </span>

        {product.description && <p className="mt-4 text-sm text-ink/80">{product.description}</p>}
      </div>

      {whatsappHref && (
        <TrackedCtaLink
          href={whatsappHref}
          organizationId={tenant.organizationId}
          ctaId="whatsapp_product"
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex w-fit items-center gap-2 rounded-brand px-5 py-3 font-medium text-white transition-opacity ${
            statusInfo.available ? "bg-leaf hover:opacity-90" : "bg-muted"
          }`}
        >
          {statusInfo.available ? "Commander sur WhatsApp" : "Nous contacter sur WhatsApp"}
        </TrackedCtaLink>
      )}
    </main>
  );
}
