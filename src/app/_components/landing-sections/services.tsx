import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";
import { buildWhatsAppLink } from "@/infrastructure/tenant/resolve-request-tenant";
import type { ServiceSummary } from "@/application/services/landing-config-service";
import { formatPrice } from "@/lib/format";
import { TrackedCtaLink } from "../tracked-cta-link";

/**
 * CTA de réservation : pointe vers l'ancre `#booking` (voir booking.tsx)
 * quand la section "booking" est activée pour ce tenant, sinon WhatsApp —
 * jamais un lien mort (mandat de vague, section "cherchez un
 * contournement réel").
 */
export function ServicesSection({
  tenant,
  services,
  hasBookingSection,
}: {
  tenant: TenantContext;
  services: ServiceSummary[];
  hasBookingSection: boolean;
}) {
  if (services.length === 0) return null;

  const whatsappHref = tenant.whatsappNumber
    ? buildWhatsAppLink(tenant.whatsappNumber, `Bonjour ${tenant.name}, je souhaite réserver un service.`)
    : null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold">Nos services</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {services.map((service) => (
          <div key={service.id} className="flex flex-col gap-2 rounded-lg border border-ink/10 bg-white p-4">
            {service.categoryName && (
              <span className="text-xs uppercase tracking-wide text-muted">{service.categoryName}</span>
            )}
            <div className="receipt-row font-display text-base font-medium">
              <span>{service.name}</span>
              <span className="shrink-0 text-brand">{formatPrice(service.price)}</span>
            </div>
            {service.durationMinutes && (
              <p className="text-xs text-muted">Durée estimée : {service.durationMinutes} min</p>
            )}
            {service.description && <p className="text-sm text-muted">{service.description}</p>}
            {hasBookingSection ? (
              <a href="#booking" className="mt-1 text-sm font-medium text-brand hover:underline">
                Réserver →
              </a>
            ) : (
              whatsappHref && (
                <TrackedCtaLink
                  href={whatsappHref}
                  organizationId={tenant.organizationId}
                  ctaId="whatsapp_service"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 text-sm font-medium text-leaf hover:underline"
                >
                  Réserver sur WhatsApp →
                </TrackedCtaLink>
              )
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
