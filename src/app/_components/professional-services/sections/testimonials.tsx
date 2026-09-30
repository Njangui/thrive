import type { ProfessionalServicesHomeModel } from "../services-model";
import { SectionHead, Stars, formatAverage } from "../services-ui";

/** Avis : défilement horizontal natif au-delà de 3, comme le template restaurant. */
export function TestimonialsSection({ testimonials }: { testimonials: NonNullable<ProfessionalServicesHomeModel["testimonials"]> }) {
  const { items, isDemo, rating } = testimonials;
  const scrolls = items.length > 3;

  const list = (
    <ul className="ps-quotes">
      {items.map((quote) => (
        <li key={quote.id} className="ps-quote">
          <figure>
            <blockquote>
              <p>« {quote.content} »</p>
            </blockquote>
            <figcaption>
              <span className="ps-quote__author">{quote.author}</span>
              {quote.rating != null && quote.rating > 0 && <Stars rating={quote.rating} label={`Note : ${quote.rating} sur 5`} />}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="ps-section" aria-labelledby="ps-quotes-title">
      <div className="ps-wrap">
        <SectionHead
          id="ps-quotes-title"
          title={testimonials.heading}
          badge={isDemo ? "Exemple" : null}
          subtitle={
            rating && !isDemo
              ? `${formatAverage(rating.average)} sur 5 en moyenne, d'après ${rating.count} ${rating.count > 1 ? "avis notés" : "avis noté"}.`
              : null
          }
        />
        {scrolls ? (
          <div className="ps-quotes-scroll" role="region" aria-label="Avis des clients" tabIndex={0}>
            {list}
          </div>
        ) : (
          list
        )}
      </div>
    </section>
  );
}
