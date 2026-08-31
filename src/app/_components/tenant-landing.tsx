import Link from "next/link";
import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";
import { buildWhatsAppLink } from "@/infrastructure/tenant/resolve-request-tenant";
import type { CatalogProductSummary } from "@/application/services/catalog-service";
import { ProductCard } from "./product-card";
import { TrackedCtaLink } from "./tracked-cta-link";

const DAY_ORDER = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

export function TenantLanding({
  tenant,
  products,
}: {
  tenant: TenantContext;
  products: CatalogProductSummary[];
}) {
  const whatsappHref = tenant.whatsappNumber
    ? buildWhatsAppLink(tenant.whatsappNumber, `Bonjour ${tenant.name}, je viens de votre site.`)
    : null;

  const hoursEntries = DAY_ORDER.filter((day) => tenant.openingHours[day]).map((day) => [
    day,
    tenant.openingHours[day],
  ]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-12 px-5 py-10 sm:py-16">
      {tenant.bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tenant.bannerUrl}
          alt=""
          className="-mx-5 aspect-[3/1] w-[calc(100%+2.5rem)] rounded-lg object-cover sm:-mx-0 sm:w-full"
        />
      )}
      <header className="flex flex-col gap-4">
        {tenant.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenant.logoUrl} alt={tenant.name} className="h-12 w-auto object-contain" />
        )}
        <div>
          <p className="text-sm font-medium text-leaf">{tenant.industry ?? "Boutique"}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {tenant.name}
          </h1>
          {tenant.description && <p className="mt-3 text-muted">{tenant.description}</p>}
        </div>
        {whatsappHref && (
          <TrackedCtaLink
            href={whatsappHref}
            organizationId={tenant.organizationId}
            ctaId="whatsapp_landing"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-2 rounded-brand bg-leaf px-5 py-3 font-medium text-white transition-opacity hover:opacity-90"
          >
            Discuter sur WhatsApp
          </TrackedCtaLink>
        )}
      </header>

      {products.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold">Nos produits</h2>
            <Link href="/produits" className="text-sm font-medium text-leaf">
              Voir tout →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {(hoursEntries.length > 0 || tenant.address || tenant.phone || tenant.email) && (
        <section className="grid grid-cols-1 gap-6 rounded-lg border border-ink/10 bg-white p-5 sm:grid-cols-2">
          {hoursEntries.length > 0 && (
            <div>
              <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-muted">
                Horaires
              </h3>
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
              <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-muted">
                Contact
              </h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {tenant.address && <li>{tenant.address}</li>}
                {tenant.phone && <li>{tenant.phone}</li>}
                {tenant.email && <li>{tenant.email}</li>}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
