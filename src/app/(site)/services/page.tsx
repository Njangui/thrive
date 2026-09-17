import type { Metadata } from "next";
import { listActiveServicesForStorefront } from "@/application/services/landing-config-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { ServiceCard } from "@/app/_components/landing-sections/services";
import { Container, EmptyState, PageHeader, Breadcrumbs } from "@/app/_components/storefront/storefront-ui";
import { requireStorefront, buildStorefrontMetadata } from "../_lib/storefront-page";

export async function generateMetadata(): Promise<Metadata> {
  const site = await requireStorefront();
  return buildStorefrontMetadata({
    path: STOREFRONT_PATHS.services,
    title: site.blueprint.headings.services ?? "Nos services",
    description: site.blueprint.subheadings.services ?? null,
  });
}

export default async function ServicesPage() {
  const site = await requireStorefront();
  const { tenant, blueprint, capabilities, whatsappHref } = site;

  // Limite haute volontairement large (100) : c'est la page exhaustive
  // des prestations, contrairement à la section d'accueil qui en montre 6.
  const services = await listActiveServicesForStorefront(tenant.organizationId, 100);

  const ctaHref = capabilities.hasServices
    ? STOREFRONT_PATHS.booking
    : whatsappHref ?? STOREFRONT_PATHS.contact;

  // Regroupement par catégorie : au-delà d'une dizaine de prestations,
  // une liste à plat devient illisible. Les prestations sans catégorie
  // sont rassemblées en fin de page plutôt que masquées.
  const grouped = new Map<string, typeof services>();
  for (const service of services) {
    const key = service.categoryName ?? "";
    const bucket = grouped.get(key);
    if (bucket) bucket.push(service);
    else grouped.set(key, [service]);
  }
  const groups = [...grouped.entries()].sort((a, b) => {
    if (a[0] === "") return 1;
    if (b[0] === "") return -1;
    return a[0].localeCompare(b[0], "fr");
  });

  return (
    <>
      <PageHeader
        eyebrow={blueprint.eyebrow}
        title={blueprint.headings.services ?? "Nos services"}
        description={blueprint.subheadings.services ?? null}
      >
        <Breadcrumbs items={[{ label: "Accueil", href: "/" }, { label: blueprint.headings.services ?? "Services" }]} />
      </PageHeader>

      <Container className="py-8 sm:py-12">
        {services.length === 0 ? (
          <EmptyState
            title="Aucune prestation publiée pour le moment"
            description={blueprint.emptyCatalogMessage}
            action={whatsappHref ? undefined : { label: "Nous contacter", href: STOREFRONT_PATHS.contact }}
          />
        ) : (
          <div className="flex flex-col gap-10">
            {groups.map(([categoryName, items]) => (
              <div key={categoryName || "_autres"}>
                {groups.length > 1 && (
                  <h2 className="mb-4 font-display text-lg font-bold tracking-tight">
                    {categoryName || "Autres prestations"}
                  </h2>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((service) => (
                    <ServiceCard key={service.id} service={service} ctaHref={ctaHref} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Container>
    </>
  );
}
