import type { CSSProperties } from "react";
import type { StorefrontHighlight } from "@/application/config/storefront-blueprint";
import { HighlightIcon } from "../../storefront/storefront-icons";
import { Container } from "../../storefront/storefront-ui";

/**
 * Bande de confiance : les promesses du commerçant (`site.highlights`,
 * modifiables dans /dashboard/site, déjà filtrées selon ce qu'il possède
 * réellement — pas de « Conseil sur WhatsApp » sans numéro WhatsApp).
 * Elle sortait auparavant du hero sous forme de trois lignes de 10 px ;
 * elle a maintenant sa propre bande, lisible d'un coup d'œil.
 */
export function TrustStrip({ items }: { items: StorefrontHighlight[] }) {
  if (items.length === 0) return null;

  return (
    <section className="rt-trust" aria-labelledby="rt-trust-title">
      <Container>
        <h2 id="rt-trust-title" className="rt-sr">
          Nos engagements
        </h2>
        <ul className="rt-trust__list" style={{ "--rt-cols": items.length } as CSSProperties}>
          {items.map((item) => (
            <li key={item.title} className="rt-trust__item">
              <HighlightIcon name={item.icon} className="rt-trust__icon" />
              <div>
                <p className="rt-trust__title">{item.title}</p>
                {item.subtitle && <p className="rt-trust__sub">{item.subtitle}</p>}
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
