import type { Metadata } from "next";
import Link from "next/link";
import { listTestimonials, listTeamMembers } from "@/application/services/landing-config-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { TestimonialsSection } from "@/app/_components/landing-sections/testimonials";
import { TeamSection } from "@/app/_components/landing-sections/team";
import { StatsBand } from "@/app/_components/landing-sections/hero";
import { Container, EmptyState, PageHeader, Breadcrumbs } from "@/app/_components/storefront/storefront-ui";
import { requireStorefront, buildStorefrontMetadata } from "../_lib/storefront-page";

export async function generateMetadata(): Promise<Metadata> {
  const site = await requireStorefront();
  return buildStorefrontMetadata({
    path: STOREFRONT_PATHS.about,
    title: "À propos",
    description: site.tenant.description ?? `Découvrez ${site.tenant.name}.`,
  });
}

/**
 * Page « À propos » : description complète (la page d'accueil n'en montre
 * qu'un extrait), chiffres réels, équipe et avis clients. Ces trois blocs
 * n'existaient que comme sections de la page d'accueil, en concurrence
 * avec le catalogue pour l'attention du visiteur ; ils ont ici une page
 * à eux, et une URL à partager.
 */
export default async function AboutPage() {
  const site = await requireStorefront();
  const { tenant, capabilities } = site;

  const [testimonials, team] = await Promise.all([
    capabilities.hasTestimonials ? listTestimonials(tenant.organizationId) : Promise.resolve([]),
    capabilities.hasTeam ? listTeamMembers(tenant.organizationId) : Promise.resolve([]),
  ]);

  const hasAnyContent = Boolean(tenant.description) || testimonials.length > 0 || team.length > 0;

  return (
    <>
      <PageHeader eyebrow={site.blueprint.eyebrow} title={`À propos de ${tenant.name}`}>
        <Breadcrumbs items={[{ label: "Accueil", href: "/" }, { label: "À propos" }]} />
      </PageHeader>

      {tenant.description && (
        <Container className="py-8 sm:py-12">
          <div className="max-w-3xl">
            <p className="whitespace-pre-line text-base leading-8 text-black/70">{tenant.description}</p>
            {(capabilities.hasContactDetails || capabilities.hasOpeningHours) && (
              <Link
                href={STOREFRONT_PATHS.contact}
                className="sf-btn-outline mt-6 inline-flex h-11 items-center px-5 text-sm"
              >
                Nous contacter
              </Link>
            )}
          </div>
        </Container>
      )}

      <StatsBand site={site} />

      {team.length > 0 && <TeamSection members={team} site={site} />}
      {testimonials.length > 0 && <TestimonialsSection testimonials={testimonials} site={site} />}

      {!hasAnyContent && (
        <Container className="py-12">
          <EmptyState
            title="Cette page est en cours de rédaction"
            description={`En attendant, découvrez ce que propose ${tenant.name}.`}
            action={{ label: "Voir le catalogue", href: STOREFRONT_PATHS.catalog }}
          />
        </Container>
      )}
    </>
  );
}
