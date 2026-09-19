import Link from "next/link";
import type { ServiceSummary } from "@/application/services/landing-config-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS, servicePath } from "@/application/config/storefront-routes";
import { sectionHeading, sectionSubheading } from "@/application/config/storefront-blueprint";
import { formatPrice } from "@/lib/format";
import { Section, SectionHeading } from "../storefront/storefront-ui";
import { StorefrontImage } from "../storefront/storefront-image";

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}

/**
 * Carte prestation, partagée par la page d'accueil et /services. Chaque
 * carte mène à sa propre fiche (`/services/<slug>`) : une prestation
 * n'était jusqu'ici qu'une ligne de texte sans page, donc sans rien à
 * partager sur WhatsApp ni à indexer.
 *
 * Catalogue V2 (0056) : vignette photo ajoutée, en miroir de
 * `product-card.tsx::ProductCard` — `StorefrontImage` affiche déjà
 * "Photo à venir" pour une prestation sans photo, donc aucun état
 * particulier à gérer ici pour les prestations plus anciennes.
 */
export function ServiceCard({ service, ctaHref }: { service: ServiceSummary; ctaHref: string }) {
  return (
    <article className="sf-card flex h-full flex-col overflow-hidden rounded-brand border border-black/[0.08] bg-white transition-all hover:border-brand/40 hover:shadow-md">
      <Link href={servicePath(service.slug)} className="relative aspect-[4/3] w-full overflow-hidden bg-black/[0.03]">
        <StorefrontImage src={service.imageUrl} alt={service.name} />
      </Link>
      <div className="flex h-full flex-col gap-2 p-5">
        {service.categoryName && (
          <p className="text-[11px] font-medium uppercase tracking-wide text-black/45">{service.categoryName}</p>
        )}
        <h3 className="font-display text-base font-semibold leading-snug">
          <Link href={servicePath(service.slug)} className="hover:text-brand">
            {service.name}
          </Link>
        </h3>
        {service.description && <p className="line-clamp-3 text-sm text-black/55">{service.description}</p>}
        <div className="mt-auto flex flex-wrap items-baseline justify-between gap-2 pt-3">
          <span className="font-display text-lg font-bold text-brand">{formatPrice(service.price)}</span>
          {service.durationMinutes ? (
            <span className="text-xs text-black/50">{formatDuration(service.durationMinutes)}</span>
          ) : null}
        </div>
        <Link href={ctaHref} className="sf-btn-outline mt-3 inline-flex h-10 items-center justify-center text-sm">
          Réserver
        </Link>
      </div>
    </article>
  );
}

export function ServicesSection({
  services,
  site,
  hasBookingSection,
}: {
  services: ServiceSummary[];
  site: StorefrontSite;
  hasBookingSection: boolean;
}) {
  if (services.length === 0) return null;
  const { blueprint, whatsappHref } = site;

  // Jamais de lien mort : ancre de réservation si la section existe sur
  // cette page, sinon la page rendez-vous, sinon WhatsApp.
  const ctaHref = hasBookingSection ? "#booking" : site.capabilities.hasServices ? STOREFRONT_PATHS.booking : whatsappHref ?? STOREFRONT_PATHS.contact;

  return (
    <Section>
      <SectionHeading
        title={sectionHeading(blueprint, "services", "Nos services")}
        subtitle={sectionSubheading(blueprint, "services")}
        action={services.length > 6 ? { label: "Toutes nos prestations", href: STOREFRONT_PATHS.services } : undefined}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {services.slice(0, 6).map((service) => (
          <ServiceCard key={service.id} service={service} ctaHref={ctaHref} />
        ))}
      </div>
    </Section>
  );
}
