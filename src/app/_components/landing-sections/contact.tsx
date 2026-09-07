import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";

const DAY_ORDER = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

export function ContactSection({ tenant }: { tenant: TenantContext }) {
  const hoursEntries = DAY_ORDER.filter((day) => tenant.openingHours[day]).map(
    (day) => [day, tenant.openingHours[day]] as const,
  );

  if (hoursEntries.length === 0 && !tenant.address && !tenant.phone && !tenant.email) return null;

  return (
    <section
      id="contact"
      className="grid grid-cols-1 gap-6 rounded-lg border border-ink/10 bg-white p-5 sm:grid-cols-2"
    >
      {hoursEntries.length > 0 && (
        <div>
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-muted">Horaires</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {hoursEntries.map(([day, range]) => (
              <li key={day} className="receipt-row">
                <span className="capitalize">{day}</span>
                <span>{range}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(tenant.address || tenant.phone || tenant.email) && (
        <div>
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-muted">Contact</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {tenant.address && <li>{tenant.address}</li>}
            {tenant.phone && <li>{tenant.phone}</li>}
            {tenant.email && <li>{tenant.email}</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
