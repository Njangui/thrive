import type { CSSProperties } from "react";
import { Container } from "../../storefront/storefront-ui";
import type { RetailHomeModel } from "../model";
import { SectionHead } from "../parts/section-head";
import { Stars } from "../parts/stars";

type QuotesData = NonNullable<RetailHomeModel["quotes"]>;

/**
 * Avis clients. Mise en page typographique (une citation, un filet, un
 * nom) plutôt que des cartes ombrées identiques. La note moyenne n'est
 * affichée que si de vraies notes existent ; en aperçu, chaque citation
 * porte la mention « Exemple ».
 */
export function Quotes({ data, tone }: { data: QuotesData; tone: "white" | "wash" }) {
  return (
    <section className={`rt-section rt-section--${tone}`} aria-labelledby="rt-quotes-title">
      <Container>
        <SectionHead id="rt-quotes-title" title={data.title}>
          {data.summary && (
            <p className="rt-rating">
              <strong className="rt-rating__value">{data.summary.average}</strong>
              <span className="rt-rating__max">/ 5</span>
              <Stars rating={data.summary.value} />
              <span className="rt-rating__count">
                {data.summary.count} avis
              </span>
            </p>
          )}
        </SectionHead>
        <ul className="rt-quotes" style={{ "--rt-cols": data.items.length } as CSSProperties}>
          {data.items.map((quote) => (
            <li key={quote.id}>
              <figure className="rt-quote">
                <Stars rating={quote.rating} />
                <blockquote className="rt-quote__text">
                  <p>{quote.content}</p>
                </blockquote>
                <figcaption className="rt-quote__author">
                  {quote.author}
                  {quote.preview && <span className="rt-quote__tag">Exemple</span>}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
