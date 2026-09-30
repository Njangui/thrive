import { StorefrontImage } from "../../storefront/storefront-image";
import { Container } from "../../storefront/storefront-ui";
import type { RetailHomeModel } from "../model";
import { SectionHead } from "../parts/section-head";

type GalleryData = NonNullable<RetailHomeModel["gallery"]>;

/**
 * Photos du catalogue que la page n'a pas déjà montrées (voir
 * `pickGalleryImages`). Le blueprint boutique active bien la section
 * « galerie » par défaut, mais l'ancien template ne la rendait jamais.
 */
export function Gallery({ data, tone }: { data: GalleryData; tone: "white" | "wash" }) {
  return (
    <section className={`rt-section rt-section--${tone}`} aria-labelledby="rt-gallery-title">
      <Container>
        <SectionHead
          id="rt-gallery-title"
          title={data.title}
          action={data.moreHref ? { label: "Voir la galerie", href: data.moreHref } : null}
        />
        <ul className="rt-gallery" data-count={data.items.length}>
          {data.items.map((image) => (
            <li key={image.url} className="rt-gallery__item">
              <StorefrontImage src={image.url} alt={image.alt} sizes="(min-width: 768px) 33vw, 50vw" fallbackLabel="" />
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
