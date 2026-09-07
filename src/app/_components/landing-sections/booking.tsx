import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";
import type { ServiceSummary } from "@/application/services/landing-config-service";
import { BookingForm } from "./booking-form";

export function BookingSection({
  tenant,
  services,
  feedback,
}: {
  tenant: TenantContext;
  services: ServiceSummary[];
  feedback?: { success?: string; error?: string };
}) {
  return (
    <section id="booking" className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-white p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">Prendre rendez-vous</h2>
        <p className="text-sm text-muted">
          Envoyez votre demande, {tenant.name} vous confirmera la disponibilité rapidement.
        </p>
      </div>
      {feedback?.success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/10 px-4 py-3 text-sm font-medium text-leaf">
          {feedback.success}
        </p>
      )}
      {feedback?.error && (
        <p className="rounded-brand border border-clay/30 bg-clay/10 px-4 py-3 text-sm font-medium text-clay">
          {feedback.error}
        </p>
      )}
      <BookingForm organizationId={tenant.organizationId} services={services} />
    </section>
  );
}
