import { StorefrontImage } from "../../storefront/storefront-image";
import type { RestaurantHomeModel } from "../restaurant-model";
import { SectionHead } from "../restaurant-ui";

/**
 * Galerie : mosaïque de 5 (une grande + quatre petites) ou rangée de 3.
 * Le modèle a déjà retiré les photos utilisées plus haut sur la page.
 * Le nom du plat sert de texte alternatif : c'est une information réelle,
 * pas une description inventée.
 */
export function GallerySection({ gallery }: { gallery: NonNullable<RestaurantHomeModel["gallery"]> }) {
  const layout = gallery.images.length >= 5 ? "mosaic" : "row";
  return (
    <section className="rl-section" aria-labelledby="rl-gallery-title">
      <div className="rl-wrap">
        <SectionHead
          id="rl-gallery-title"
          title={gallery.heading}
          action={gallery.href ? { label: "Voir la galerie", href: gallery.href } : null}
        />
        <ul className={`rl-gallery rl-gallery--${layout}`}>
          {gallery.images.map((image) => (
            <li key={image.url} className="rl-gallery__item">
              <StorefrontImage src={image.url} alt={image.productName} sizes="(min-width: 900px) 30vw, 50vw" fallbackLabel="" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
