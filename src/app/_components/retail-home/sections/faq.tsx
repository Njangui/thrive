import Link from "next/link";
import { Container } from "../../storefront/storefront-ui";
import type { RetailHomeModel } from "../model";
import { CtaLink } from "../parts/cta-link";

type FaqData = NonNullable<RetailHomeModel["faq"]>;

/**
 * Questions fréquentes en accordéon natif `<details>` : aucun JavaScript,
 * clavier et lecteurs d'écran gérés par le navigateur. Comme la galerie,
 * cette section figure dans le blueprint boutique mais n'était jamais
 * rendue par l'ancien template.
 */
export function Faq({ data, organizationId, tone }: { data: FaqData; organizationId: string; tone: "white" | "wash" }) {
  return (
    <section className={`rt-section rt-section--${tone}`} aria-labelledby="rt-faq-title">
      <Container className="rt-faq">
        <div className="rt-faq__intro">
          <h2 id="rt-faq-title" className="rt-h2">
            {data.title}
          </h2>
          <p className="rt-head__sub">Une autre question ? Écrivez-nous, nous répondons directement.</p>
          <div className="rt-actions">
            {data.cta && <CtaLink cta={data.cta} organizationId={organizationId} className="rt-btn rt-btn--solid" />}
            {data.moreHref && (
              <Link href={data.moreHref} className="rt-link">
                Toutes les questions
              </Link>
            )}
          </div>
        </div>
        <div className="rt-faq__list">
          {data.items.map((item) => (
            <details key={item.id} className="rt-faq__item">
              <summary className="rt-faq__q">{item.question}</summary>
              <p className="rt-faq__a">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
