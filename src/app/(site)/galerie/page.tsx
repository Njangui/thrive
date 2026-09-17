import type { Metadata } from "next";
import { listGalleryImages } from "@/application/services/landing-config-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { StorefrontImage } from "@/app/_components/storefront/storefront-image";
import { Container, EmptyState, PageHeader, Breadcrumbs } from "@/app/_components/storefront/storefront-ui";
import { requireStorefront, buildStorefrontMetadata } from "../_lib/storefront-page";

export async function generateMetadata(): Promise<Metadata> {
  const site = await requireStorefront();
  return buildStorefrontMetadata({
    path: STOREFRONT_PATHS.gallery,
    title: site.blueprint.headings.gallery ?? "Galerie",
    description: site.blueprint.subheadings.gallery ?? null,
  });
}

export default async function GalleryPage() {
  const site = await requireStorefront();
  // Page exhaustive : 60 photos au lieu des 8 de la section d'accueil.
  const images = await listGalleryImages(site.tenant.organizationId, 60);

  return (
    <>
      <PageHeader
        eyebrow={site.blueprint.eyebrow}
        title={site.blueprint.headings.gallery ?? "Galerie"}
        description={site.blueprint.subheadings.gallery ?? null}
      >
        <Breadcrumbs items={[{ label: "Accueil", href: "/" }, { label: site.blueprint.headings.gallery ?? "Galerie" }]} />
      </PageHeader>

      <Container className="py-8 sm:py-12">
        {images.length === 0 ? (
          <EmptyState
            title="Aucune photo pour le moment"
            description="Les photos publiées avec nos articles apparaîtront ici."
            action={{ label: `Voir ${site.blueprint.catalogLabel.toLowerCase()}`, href: STOREFRONT_PATHS.catalog }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image, index) => (
              <figure
                key={`${image.url}-${index}`}
                className="relative aspect-square overflow-hidden rounded-brand border border-black/[0.06] bg-black/[0.03]"
              >
                <StorefrontImage
                  src={image.url}
                  alt={image.productName}
                  sizes="(min-width: 1024px) 25vw, 50vw"
                  fallbackLabel=""
                />
              </figure>
            ))}
          </div>
        )}
      </Container>
    </>
  );
}
