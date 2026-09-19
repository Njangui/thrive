import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { resolveRequestTenant, resolveRequestOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { getProductBySlug, listStorefrontProducts } from "@/application/services/catalog-service";
import { trackEvent } from "@/application/services/analytics-service";
import { resolveProductSeo, buildProductJsonLd, type ProductJsonLdAvailability } from "@/lib/seo";
import { STOREFRONT_PATHS, productPath } from "@/application/config/storefront-routes";
import { TrackedCtaLink } from "@/app/_components/tracked-cta-link";
import { formatPrice } from "@/lib/format";
import { StorefrontImage } from "@/app/_components/storefront/storefront-image";
import { SpecificationsTable } from "@/app/_components/storefront/specifications-table";
import { ProductPrice } from "@/app/_components/storefront/product-price";
import { CountdownTimer } from "@/app/_components/storefront/countdown-timer";
import { ProductGrid } from "@/app/_components/storefront/product-card";
import { Container, Breadcrumbs, SectionHeading } from "@/app/_components/storefront/storefront-ui";
import { requireStorefront, buildBreadcrumbJsonLd } from "../../_lib/storefront-page";

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

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await resolveRequestTenant();
  if (!tenant) return {};

  const product = await getProductBySlug(tenant.organizationId, slug);
  if (!product) return {};

  const origin = await resolveRequestOrigin();
  const canonicalUrl = `${origin}${productPath(slug)}`;
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
  const site = await requireStorefront();
  const { tenant, blueprint } = site;

  const product = await getProductBySlug(tenant.organizationId, slug);
  if (!product) notFound();

  // Best-effort, ne fait jamais échouer le rendu (voir analytics-service).
  // Démarré avant le reste, attendu juste avant de rendre.
  const trackProductView = trackEvent(tenant.organizationId, "product_view", "product", product.id);

  const statusInfo = STATUS_LABELS[product.status] ?? { label: product.status, available: false };

  const whatsappHref = tenant.whatsappNumber
    ? buildWhatsAppLink(
        tenant.whatsappNumber,
        `Bonjour, je suis intéressé(e) par "${product.name}" (${formatPrice(product.unitPrice)}).`,
      )
    : null;

  const origin = await resolveRequestOrigin();

  // Produits similaires : même vitrine, hors produit courant. Une fiche
  // produit sans rebond est un cul-de-sac — le visiteur arrivé par un
  // lien WhatsApp repartait sans jamais voir le reste du catalogue.
  const related = await listStorefrontProducts(tenant.organizationId, {
    limit: 4,
    excludeProductId: product.id,
    sort: "featured",
  });

  // JSON-LD Product/Offer uniquement pour un produit actif ou en rupture :
  // on ne déclare pas à Google un produit draft/inactif retiré
  // volontairement, même si la page reste consultable par un lien direct
  // déjà partagé.
  const jsonLdAvailability = JSON_LD_AVAILABILITY[product.status];
  const productJsonLd = jsonLdAvailability
    ? buildProductJsonLd({
        name: product.name,
        description: product.description,
        images: product.images,
        url: `${origin}${productPath(slug)}`,
        unitPrice: product.unitPrice,
        currency: tenant.currency,
        availability: jsonLdAvailability,
      })
    : null;

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(origin, [
    { label: "Accueil", href: "/" },
    { label: blueprint.catalogLabel, href: STOREFRONT_PATHS.catalog },
    { label: product.name, href: productPath(slug) },
  ]);

  await trackProductView;

  return (
    <>
      {productJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <Container className="py-6 sm:py-10">
        <Breadcrumbs
          items={[
            { label: "Accueil", href: "/" },
            { label: blueprint.catalogLabel, href: STOREFRONT_PATHS.catalog },
            { label: product.name },
          ]}
        />

        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="flex flex-col gap-3">
            <div className="relative aspect-square w-full overflow-hidden rounded-brand border border-black/[0.08] bg-black/[0.03]">
              <StorefrontImage
                src={product.images[0]}
                alt={product.name}
                sizes="(min-width: 1024px) 50vw, 100vw"
                priority
                fallbackLabel="Aucune photo pour ce produit"
              />
            </div>
            {product.images.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {product.images.slice(1, 5).map((url) => (
                  <div
                    key={url}
                    className="relative aspect-square overflow-hidden rounded-brand border border-black/[0.08] bg-black/[0.03]"
                  >
                    <StorefrontImage src={url} alt={product.name} sizes="120px" fallbackLabel="" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {product.categoryName && (
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">{product.categoryName}</p>
            )}
            <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-4xl">{product.name}</h1>

            <ProductPrice unitPrice={product.unitPrice} compareAtPrice={product.compareAtPrice} size="lg" />

            {product.promotionEndsAt && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Offre limitée — se termine dans</p>
                <CountdownTimer endsAt={product.promotionEndsAt} variant="full" />
              </div>
            )}

            <span
              className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${
                statusInfo.available ? "bg-leaf/10 text-leaf" : "bg-black/[0.07] text-black/55"
              }`}
            >
              {statusInfo.label}
            </span>

            {product.description && (
              <p className="whitespace-pre-line text-sm leading-7 text-black/70">{product.description}</p>
            )}

            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              {whatsappHref && (
                <TrackedCtaLink
                  href={whatsappHref}
                  organizationId={tenant.organizationId}
                  ctaId="whatsapp_product"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-btn-primary inline-flex h-12 items-center justify-center px-6 text-sm"
                >
                  {statusInfo.available ? "Commander sur WhatsApp" : "Me prévenir du retour en stock"}
                </TrackedCtaLink>
              )}
              <Link href={STOREFRONT_PATHS.catalog} className="sf-btn-outline inline-flex h-12 items-center justify-center px-6 text-sm">
                Continuer mes achats
              </Link>
            </div>

            {!whatsappHref && (tenant.phone || tenant.email) && (
              // Repli honnête : sans WhatsApp configuré, la fiche affiche
              // le canal réellement disponible plutôt qu'aucun moyen de
              // commander.
              <p className="text-sm text-black/60">
                Pour commander, contactez-nous{" "}
                {tenant.phone && (
                  <a href={`tel:${tenant.phone.replace(/\s/g, "")}`} className="font-semibold text-brand hover:underline">
                    au {tenant.phone}
                  </a>
                )}
                {tenant.phone && tenant.email && " ou "}
                {tenant.email && (
                  <a href={`mailto:${tenant.email}`} className="font-semibold text-brand hover:underline">
                    par e-mail
                  </a>
                )}
                .
              </p>
            )}
          </div>
        </div>

        <SpecificationsTable specifications={product.specifications} />

        {related.length > 0 && (
          <div className="mt-14 border-t border-black/[0.07] pt-10">
            <SectionHeading
              title="Vous aimerez aussi"
              action={{ label: `Voir ${blueprint.catalogLabel.toLowerCase()}`, href: STOREFRONT_PATHS.catalog }}
            />
            <ProductGrid
              products={related}
              organizationId={tenant.organizationId}
              newBadgeLabel={blueprint.newBadgeLabel}
            />
          </div>
        )}
      </Container>
    </>
  );
}
