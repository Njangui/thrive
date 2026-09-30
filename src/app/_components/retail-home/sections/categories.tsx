import Link from "next/link";
import type { CSSProperties } from "react";
import { StorefrontImage } from "../../storefront/storefront-image";
import { Container } from "../../storefront/storefront-ui";
import type { RetailHomeModel } from "../model";
import { SectionHead } from "../parts/section-head";

type CategoriesData = NonNullable<RetailHomeModel["categories"]>;

/**
 * Catégories en vignettes photo. Le nombre de vignettes est ajusté en
 * amont (`fitCategoryCount`) pour ne jamais laisser une rangée orpheline ;
 * sur mobile, elles défilent horizontalement (snap) — un geste naturel au
 * pouce, sans aucun JavaScript.
 */
export function Categories({ data, tone }: { data: CategoriesData; tone: "white" | "wash" }) {
  return (
    <section className={`rt-section rt-section--${tone}`} aria-labelledby="rt-cats-title">
      <Container>
        <SectionHead
          id="rt-cats-title"
          title={data.title}
          action={data.moreHref ? { label: "Toutes les catégories", href: data.moreHref } : null}
        />
        <ul className="rt-cats" data-count={data.items.length} style={{ "--rt-cols": data.columns } as CSSProperties}>
          {data.items.map((category) => (
            <li key={category.id}>
              <Link href={category.href} className="rt-cat">
                <span className="rt-cat__media">
                  {category.imageUrl ? (
                    <StorefrontImage src={category.imageUrl} alt="" sizes="(min-width: 768px) 25vw, 62vw" fallbackLabel="" />
                  ) : (
                    <span className="rt-cat__initial" aria-hidden>
                      {category.name.slice(0, 1)}
                    </span>
                  )}
                </span>
                <span className="rt-cat__label">
                  <span className="rt-cat__name">{category.name}</span>
                  <span className="rt-cat__count">{category.countLabel}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
