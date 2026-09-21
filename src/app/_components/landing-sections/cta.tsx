import Link from "next/link";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { TrackedCtaLink } from "../tracked-cta-link";
import { Container } from "../storefront/storefront-ui";

/**
 * Bandeau d'appel à l'action final. Auparavant conditionné au seul
 * WhatsApp (`if (!tenant.whatsappNumber) return null`), ce qui le faisait
 * disparaître entièrement chez un tenant joignable par téléphone ou par
 * formulaire de rendez-vous. Il retombe maintenant sur la meilleure
 * destination disponible, et ne disparaît que s'il n'en existe aucune.
 */
export function CtaSection({ site }: { site: StorefrontSite }) {
  const { tenant, whatsappHref, capabilities, blueprint } = site;

  const fallbackHref = capabilities.hasServices && capabilities.bookingEnabled
    ? STOREFRONT_PATHS.booking
    : capabilities.hasContactDetails || capabilities.hasOpeningHours
      ? STOREFRONT_PATHS.contact
      : null;

  if (!whatsappHref && !fallbackHref) return null;

  return (
    <section className="sf-cta bg-brand py-12 text-white sm:py-16">
      <Container className="flex flex-col items-center gap-4 text-center">
        <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Une question sur {blueprint.catalogLabel.toLowerCase()} ?
        </h2>
        <p className="max-w-lg text-sm text-white/80 sm:text-base">
          Écrivez-nous — {tenant.name} vous répond directement, sans compte à créer.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          {whatsappHref && (
            <TrackedCtaLink
              href={whatsappHref}
              organizationId={tenant.organizationId}
              ctaId="cta_whatsapp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center rounded-brand bg-white px-6 text-sm font-semibold text-brand transition-opacity hover:opacity-90"
            >
              Discuter sur WhatsApp
            </TrackedCtaLink>
          )}
          {fallbackHref && (
            <Link
              href={fallbackHref}
              className="inline-flex h-12 items-center rounded-brand border border-white/40 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              {capabilities.hasServices ? "Prendre rendez-vous" : "Nous contacter"}
            </Link>
          )}
        </div>
      </Container>
    </section>
  );
}
