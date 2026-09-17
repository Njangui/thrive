import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { listActiveServicesForStorefront } from "@/application/services/landing-config-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { sectionSubheading } from "@/application/config/storefront-blueprint";
import { BookingForm } from "@/app/_components/landing-sections/booking-form";
import { ContactDetails } from "@/app/_components/landing-sections/contact";
import { Container, PageHeader, Breadcrumbs } from "@/app/_components/storefront/storefront-ui";
import { requireStorefront, buildStorefrontMetadata } from "../_lib/storefront-page";

export async function generateMetadata(): Promise<Metadata> {
  const site = await requireStorefront();
  return buildStorefrontMetadata({
    path: STOREFRONT_PATHS.booking,
    title: site.blueprint.headings.booking ?? "Prendre rendez-vous",
    description: `Demandez un créneau chez ${site.tenant.name} — réponse rapide.`,
  });
}

export default async function BookingPage({
  searchParams,
}: {
  searchParams: Promise<{ bookingSuccess?: string; bookingError?: string }>;
}) {
  const { bookingSuccess, bookingError } = await searchParams;
  const site = await requireStorefront();
  const { tenant, blueprint, capabilities } = site;

  // Cohérent avec `routeIsAvailable` : sans prestation ni canal de
  // contact, la demande n'aurait aucun destinataire — 404 plutôt qu'un
  // formulaire qui envoie dans le vide.
  const reachable = capabilities.hasServices || capabilities.hasWhatsApp || Boolean(tenant.phone) || Boolean(tenant.email);
  if (!reachable) notFound();

  const services = await listActiveServicesForStorefront(tenant.organizationId, 100);

  return (
    <>
      <PageHeader
        eyebrow={blueprint.eyebrow}
        title={blueprint.headings.booking ?? "Prendre rendez-vous"}
        description={
          sectionSubheading(blueprint, "booking") ??
          `Choisissez un créneau : ${tenant.name} vous confirme la disponibilité.`
        }
      >
        <Breadcrumbs
          items={[{ label: "Accueil", href: "/" }, { label: blueprint.headings.booking ?? "Rendez-vous" }]}
        />
      </PageHeader>

      <Container className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_320px] sm:py-12">
        <div>
          {bookingSuccess && (
            <p role="status" className="mb-4 rounded-brand border border-leaf/30 bg-leaf/10 px-4 py-3 text-sm font-medium text-leaf">
              {bookingSuccess}
            </p>
          )}
          {bookingError && (
            <p role="alert" className="mb-4 rounded-brand border border-clay/30 bg-clay/10 px-4 py-3 text-sm font-medium text-clay">
              {bookingError}
            </p>
          )}
          <div className="rounded-brand border border-black/[0.08] bg-white p-5 sm:p-6">
            <BookingForm
              organizationId={tenant.organizationId}
              services={services}
              returnTo={STOREFRONT_PATHS.booking}
            />
          </div>
          <p className="mt-3 text-xs text-black/50">
            Votre demande n&apos;est pas encore confirmée : {tenant.name} la validera et reviendra vers vous.
          </p>
        </div>

        {(capabilities.hasContactDetails || capabilities.hasOpeningHours) && (
          <aside className="flex flex-col gap-4">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-black/50">
              Ou joignez-nous directement
            </h2>
            <ContactDetails site={site} />
          </aside>
        )}
      </Container>
    </>
  );
}
