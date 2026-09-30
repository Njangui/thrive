import Link from "next/link";
import { Container } from "../../storefront/storefront-ui";
import type { RetailHomeModel } from "../model";
import { ProductCard } from "../parts/product-card";
import { PromoCountdown } from "../parts/promo-countdown";

type PromoData = NonNullable<RetailHomeModel["promo"]>;

/**
 * Bandeau d'offres, sur la couleur d'accent du commerçant. Ne s'affiche
 * qu'avec de VRAIES promotions en cours ; le compte à rebours n'apparaît
 * que si l'une d'elles a une échéance réelle.
 */
export function PromoBand({ data, organizationId }: { data: PromoData; organizationId: string }) {
  return (
    <section className="rt-promo" aria-labelledby="rt-promo-title">
      <Container>
        <header className="rt-promo__head">
          <div className="rt-head__text">
            <h2 id="rt-promo-title" className="rt-h2">
              {data.title}
            </h2>
            <p className="rt-head__sub">{data.subtitle}</p>
          </div>
          <div className="rt-promo__aside">
            {data.deadline && <PromoCountdown endsAt={data.deadline} />}
            {data.moreHref && (
              <Link href={data.moreHref} className="rt-btn rt-btn--outline-on-accent">
                Toutes les promotions
              </Link>
            )}
          </div>
        </header>
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
