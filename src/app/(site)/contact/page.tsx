import type { Metadata } from "next";
import { resolveCanonicalOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { JsonLd } from "@/app/_components/json-ld";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { buildOrganizationJsonLd } from "@/lib/seo";
import { ContactDetails, buildGoogleMapsSearchUrl } from "@/app/_components/landing-sections/contact";
import { TrackedCtaLink } from "@/app/_components/tracked-cta-link";
import { Container, EmptyState, PageHeader, Breadcrumbs } from "@/app/_components/storefront/storefront-ui";
import { requireStorefront, buildStorefrontMetadata, buildBreadcrumbJsonLd } from "../_lib/storefront-page";

export async function generateMetadata(): Promise<Metadata> {
  const site = await requireStorefront();
  return buildStorefrontMetadata({
    path: STOREFRONT_PATHS.contact,
    title: "Contact",
    description: `Adresse, horaires et coordonnées de ${site.tenant.name}.`,
  });
}

export default async function ContactPage() {
  const site = await requireStorefront();
  const { tenant, capabilities, whatsappHref } = site;
  const origin = await resolveCanonicalOrigin();

  // `LocalBusiness` sur la page contact plutôt que seulement sur
  // l'accueil : c'est la page qui porte l'adresse et les horaires, donc
  // celle dont Google attend ces données structurées pour alimenter une
  // fiche locale.
  const organizationJsonLd = buildOrganizationJsonLd({
    name: tenant.name,
    description: tenant.description,
    url: `${origin}${STOREFRONT_PATHS.contact}`,
    logoUrl: tenant.logoUrl,
    telephone: tenant.phone,
    email: tenant.email,
    address: tenant.address,
    openingHours: tenant.openingHours,
    socialLinks: tenant.socialLinks,
  });

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(origin, [
    { label: "Accueil", href: "/" },
    { label: "Contact", href: STOREFRONT_PATHS.contact },
  ]);

  return (
    <>
      <JsonLd data={organizationJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />

      <PageHeader
        title="Nous contacter"
        description={`Toutes les façons de joindre ${tenant.name}.`}
      >
        <Breadcrumbs items={[{ label: "Accueil", href: "/" }, { label: "Contact" }]} />
      </PageHeader>

      <Container className="py-8 sm:py-12">
        {!capabilities.hasContactDetails && !capabilities.hasOpeningHours ? (
          <EmptyState
            title="Coordonnées à venir"
            description="Les informations de contact ne sont pas encore renseignées."
            action={{ label: "Retour à l'accueil", href: "/" }}
          />
        ) : (
          <div className="flex flex-col gap-8">
            <ContactDetails site={site} />

            {whatsappHref && (
              <div className="rounded-brand border border-black/[0.08] bg-[var(--brand-soft,rgba(0,0,0,.03))] p-6">
                <h2 className="font-display text-lg font-bold">Le plus rapide : WhatsApp</h2>
                <p className="mt-1.5 max-w-xl text-sm text-black/60">
                  Posez votre question directement, nous répondons depuis le même numéro que celui affiché ci-dessus.
                </p>
                <TrackedCtaLink
                  href={whatsappHref}
                  organizationId={tenant.organizationId}
                  ctaId="contact_page_whatsapp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-btn-primary mt-4 inline-flex h-12 items-center px-6 text-sm"
                >
                  Démarrer la conversation
                </TrackedCtaLink>
              </div>
            )}

            {tenant.address && (
              <div className="rounded-brand border border-black/[0.08] bg-white p-6">
                <h2 className="font-display text-lg font-bold">Nous trouver</h2>
                <p className="mt-1.5 text-sm text-black/60">{tenant.address}</p>
                {/* Lien Maps plutôt qu'une carte intégrée : l'API Maps Embed
                    exige une clé facturée par tenant, et un iframe tiers
                    contredirait la politique CSP posée dans next.config.mjs. */}
                <a
                  href={buildGoogleMapsSearchUrl(tenant.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-btn-outline mt-4 inline-flex h-11 items-center px-5 text-sm"
                >
                  Ouvrir l&apos;itinéraire
                </a>
              </div>
            )}
          </div>
        )}
      </Container>
    </>
  );
}
