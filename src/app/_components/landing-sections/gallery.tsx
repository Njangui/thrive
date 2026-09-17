import type { GalleryImage } from "@/application/services/landing-config-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { sectionHeading, sectionSubheading } from "@/application/config/storefront-blueprint";
import { StorefrontImage } from "../storefront/storefront-image";
import { Section, SectionHeading } from "../storefront/storefront-ui";

export function GallerySection({ images, site }: { images: GalleryImage[]; site: StorefrontSite }) {
  if (images.length === 0) return null;
  const { blueprint } = site;

  return (
    <Section>
      <SectionHeading
        title={sectionHeading(blueprint, "gallery", "Galerie")}
        subtitle={sectionSubheading(blueprint, "gallery")}
        action={images.length > 8 ? { label: "Voir toutes les photos", href: STOREFRONT_PATHS.gallery } : undefined}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {images.slice(0, 8).map((image, index) => (
          <div
            key={`${image.url}-${index}`}
            className="relative aspect-square overflow-hidden rounded-brand border border-black/[0.06] bg-black/[0.03]"
          >
            {/* `alt` = nom du produit photographié : une galerie issue du
                catalogue décrit réellement ce qu'elle montre, ce qui la rend
                utilisable au lecteur d'écran et indexable en recherche image. */}
            <StorefrontImage
              src={image.url}
              alt={image.productName}
              sizes="(min-width: 1024px) 25vw, 50vw"
              fallbackLabel=""
            />
          </div>
        ))}
      </div>
    </Section>
  );
}
