import type { RestaurantHomeModel } from "../restaurant-model";
import { SectionHead, Stars, formatAverage } from "../restaurant-ui";

/**
 * Avis : défilement horizontal natif (scroll-snap), sans JavaScript et sans
 * flèches décoratives. Jusqu'à 3 avis ils tiennent côte à côte ; au-delà, la
 * zone défile et devient accessible au clavier.
 */
export function TestimonialsSection({ testimonials }: { testimonials: NonNullable<RestaurantHomeModel["testimonials"]> }) {
  const { items, isDemo, rating } = testimonials;
  const scrolls = items.length > 3;

  const list = (
    <ul className="rl-quotes">
      {items.map((quote) => (
        <li key={quote.id} className="rl-quote">
          <figure>
            <blockquote>
              <p>« {quote.content} »</p>
            </blockquote>
            <figcaption>
              <span className="rl-quote__author">{quote.author}</span>
              {quote.rating != null && quote.rating > 0 && <Stars rating={quote.rating} label={`Note : ${quote.rating} sur 5`} />}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="rl-section" aria-labelledby="rl-quotes-title">
      <div className="rl-wrap">
        <SectionHead
          id="rl-quotes-title"
          title={testimonials.heading}
          badge={isDemo ? "Exemple" : null}
          subtitle={
            rating && !isDemo
              ? `${formatAverage(rating.average)} sur 5 en moyenne, d'après ${rating.count} ${rating.count > 1 ? "avis notés" : "avis noté"}.`
              : null
          }
        />
        {scrolls ? (
          <div className="rl-quotes-scroll" role="region" aria-label="Avis des clients" tabIndex={0}>
            {list}
          </div>
        ) : (
          list
        )}
      </div>
    </section>
  );
}
