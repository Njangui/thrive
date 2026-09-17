import type { ServiceSummary } from "@/application/services/landing-config-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { sectionHeading, sectionSubheading } from "@/application/config/storefront-blueprint";
import { BookingForm } from "./booking-form";
import { Section, SectionHeading } from "../storefront/storefront-ui";

export function BookingSection({
  site,
  services,
  feedback,
}: {
  site: StorefrontSite;
  services: ServiceSummary[];
  feedback?: { success?: string; error?: string };
}) {
  const { tenant, blueprint } = site;

  return (
    <Section id="booking" tone="muted">
      <SectionHeading
        title={sectionHeading(blueprint, "booking", "Prendre rendez-vous")}
        subtitle={
          sectionSubheading(blueprint, "booking") ??
          `Envoyez votre demande, ${tenant.name} vous confirmera la disponibilité.`
        }
      />

      <div className="max-w-2xl">
        {feedback?.success && (
          <p role="status" className="mb-4 rounded-brand border border-leaf/30 bg-leaf/10 px-4 py-3 text-sm font-medium text-leaf">
            {feedback.success}
          </p>
        )}
        {feedback?.error && (
          <p role="alert" className="mb-4 rounded-brand border border-clay/30 bg-clay/10 px-4 py-3 text-sm font-medium text-clay">
            {feedback.error}
          </p>
        )}
        <div className="rounded-brand border border-black/[0.08] bg-white p-5 sm:p-6">
          <BookingForm organizationId={tenant.organizationId} services={services} />
        </div>
      </div>
    </Section>
  );
}
