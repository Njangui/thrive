import Link from "next/link";
import { StorefrontImage } from "../../storefront/storefront-image";
import { Container } from "../../storefront/storefront-ui";
import type { RetailHomeModel } from "../model";

type StoryData = NonNullable<RetailHomeModel["story"]>;

/**
 * « À propos » : la description RÉELLE saisie par le commerçant et ses
 * chiffres RÉELS (`site.stats`, calculés en base, absents sous trois
 * valeurs). L'ancien bloc « L'esprit de la boutique » parlait au
 * commerçant (« Une vitrine qui ressemble à votre entreprise ») au lieu de
 * parler à l'acheteur, et affichait trois promesses génériques identiques
 * pour tout le monde.
 */
export function Story({ data, tone }: { data: StoryData; tone: "white" | "wash" }) {
  return (
    <section className={`rt-section rt-section--${tone}`} aria-labelledby="rt-story-title">
      <Container className={data.imageUrl ? "rt-story" : "rt-story rt-story--solo"}>
        {data.imageUrl && (
          <div className="rt-story__media">
            <StorefrontImage src={data.imageUrl} alt="" sizes="(min-width: 1024px) 45vw, 100vw" fallbackLabel="" />
          </div>
        )}
        <div className="rt-story__copy">
          <h2 id="rt-story-title" className="rt-h2">
            {data.title}
          </h2>
          {data.body && <p className="rt-story__body">{data.body}</p>}
          {data.facts.length > 0 && (
            <dl className="rt-facts">
              {data.facts.map((fact) => (
                <div key={fact.key} className="rt-fact">
                  <dt className="rt-fact__label">{fact.label}</dt>
                  <dd className="rt-fact__value">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {data.moreHref && (
            <Link href={data.moreHref} className="rt-btn rt-btn--outline">
              En savoir plus
            </Link>
          )}
        </div>
      </Container>
    </section>
  );
}
