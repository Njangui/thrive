import { Container } from "../../storefront/storefront-ui";
import type { RetailHomeModel } from "../model";
import { ProductCard } from "../parts/product-card";
import { SectionHead } from "../parts/section-head";

type ShelfData = NonNullable<RetailHomeModel["shelf"]>;

/** Sélection de produits : 2 colonnes sur mobile, 4 sur grand écran. */
export function Shelf({ data, organizationId, tone }: { data: ShelfData; organizationId: string; tone: "white" | "wash" }) {
  return (
    <section className={`rt-section rt-section--${tone}`} aria-labelledby="rt-shelf-title">
      <Container>
        <SectionHead
          id="rt-shelf-title"
          title={data.title}
          subtitle={data.subtitle}
          action={data.moreHref ? { label: "Voir toute la boutique", href: data.moreHref } : null}
        />
        <ul className="rt-grid">
          {data.items.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} organizationId={organizationId} />
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
