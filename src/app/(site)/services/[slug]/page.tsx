import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { resolveRequestTenant, resolveRequestOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { getServiceBySlug, listRelatedServices } from "@/application/services/landing-config-service";
import { STOREFRONT_PATHS, servicePath } from "@/application/config/storefront-routes";
import { formatPrice } from "@/lib/format";
import { TrackedCtaLink } from "@/app/_components/tracked-cta-link";
import { ServiceCard } from "@/app/_components/landing-sections/services";
import { StorefrontImage } from "@/app/_components/storefront/storefront-image";
import { SpecificationsTable } from "@/app/_components/storefront/specifications-table";
import { Container, Breadcrumbs, SectionHeading } from "@/app/_components/storefront/storefront-ui";
import { IconClock } from "@/app/_components/storefront/storefront-icons";
import { requireStorefront, buildStorefrontMetadata, buildBreadcrumbJsonLd } from "../../_lib/storefront-page";

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await resolveRequestTenant();
  if (!tenant) return {};

  const service = await getServiceBySlug(tenant.organizationId, slug);
  if (!service) return {};

  return buildStorefrontMetadata({
    path: servicePath(slug),
    title: service.name,
    description: service.description ?? `${service.name} — ${formatPrice(service.price)} chez ${tenant.name}.`,
  });
}

export default async function ServiceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await requireStorefront();
  const { tenant, blueprint, capabilities } = site;

  const service = await getServiceBySlug(tenant.organizationId, slug);
  if (!service) notFound();

  const [related, origin] = await Promise.all([
    listRelatedServices(tenant.organizationId, service.id),
    resolveRequestOrigin(),
  ]);

  const available = service.status === "active";
  const whatsappHref = tenant.whatsappNumber
    ? buildWhatsAppLink(
        tenant.whatsappNumber,
        `Bonjour, je souhaite réserver « ${service.name} » (${formatPrice(service.price)}).`,
      )
    : null;

  const bookingHref = capabilities.hasServices ? STOREFRONT_PATHS.booking : null;

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(origin, [
    { label: "Accueil", href: "/" },
    { label: blueprint.headings.services ?? "Services", href: STOREFRONT_PATHS.services },
    { label: service.name, href: servicePath(slug) },
  ]);

  // schema.org/Service : le pendant de `buildProductJsonLd` pour une
  // prestation. Une fiche prestation sans données structurées n'apparaît
  // jamais en résultat enrichi, là où une fiche produit le peut — écart
  // corrigé ici. `offers` n'est déclaré que pour une prestation active,
  // même règle que pour les produits.
  const serviceJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.name,
    ...(service.description ? { description: service.description } : {}),
    ...(service.categoryName ? { serviceType: service.categoryName } : {}),
    provider: { "@type": "LocalBusiness", name: tenant.name, ...(tenant.address ? { address: tenant.address } : {}) },
    url: `${origin}${servicePath(slug)}`,
    ...(available
      ? {
          offers: {
            "@type": "Offer",
            price: service.price,
            priceCurrency: tenant.currency,
            availability: "https://schema.org/InStock",
          },
        }
      : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <Container className="py-6 sm:py-10">
        <Breadcrumbs
          items={[
            { label: "Accueil", href: "/" },
            { label: blueprint.headings.services ?? "Services", href: STOREFRONT_PATHS.services },
            { label: service.name },
          ]}
        />

        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="flex flex-col gap-3">
            <div className="relative aspect-square w-full overflow-hidden rounded-brand border border-black/[0.08] bg-black/[0.03]">
              <StorefrontImage
                src={service.images[0]}
                alt={service.name}
                sizes="(min-width: 1024px) 50vw, 100vw"
                priority
                fallbackLabel="Aucune photo pour cette prestation"
              />
            </div>
            {service.images.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {service.images.slice(1, 5).map((url) => (
                  <div
                    key={url}
                    className="relative aspect-square overflow-hidden rounded-brand border border-black/[0.08] bg-black/[0.03]"
                  >
                    <StorefrontImage src={url} alt={service.name} sizes="120px" fallbackLabel="" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {service.categoryName && (
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">{service.categoryName}</p>
            )}
            <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-4xl">{service.name}</h1>

            <div className="flex flex-wrap items-center gap-4">
              <span className="font-display text-2xl font-bold text-brand">{formatPrice(service.price)}</span>
              {service.durationMinutes ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-black/60">
                  <IconClock className="h-4 w-4" />
                  {formatDuration(service.durationMinutes)}
                </span>
              ) : null}
              {!available && (
                <span className="rounded-full bg-black/[0.07] px-3 py-1 text-xs font-semibold text-black/55">
                  Actuellement indisponible
                </span>
              )}
            </div>

            {service.description && (
              <p className="whitespace-pre-line text-base leading-8 text-black/70">{service.description}</p>
            )}

            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              {bookingHref && (
                <Link href={bookingHref} className="sf-btn-primary inline-flex h-12 items-center justify-center px-6 text-sm">
                  Demander ce rendez-vous
                </Link>
              )}
              {whatsappHref && (
                <TrackedCtaLink
                  href={whatsappHref}
                  organizationId={tenant.organizationId}
                  ctaId="whatsapp_service_detail"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-btn-outline inline-flex h-12 items-center justify-center px-6 text-sm"
                >
                  En parler sur WhatsApp
                </TrackedCtaLink>
              )}
            </div>
          </div>
        </div>

        <SpecificationsTable specifications={service.specifications} />

        {related.length > 0 && (
          <div className="mt-14 border-t border-black/[0.07] pt-10">
            <SectionHeading
              title="Autres prestations"
              action={{ label: "Tout voir", href: STOREFRONT_PATHS.services }}
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((item) => (
                <ServiceCard key={item.id} service={item} ctaHref={bookingHref ?? STOREFRONT_PATHS.contact} />
              ))}
            </div>
          </div>
        )}
      </Container>
    </>
  );
}
