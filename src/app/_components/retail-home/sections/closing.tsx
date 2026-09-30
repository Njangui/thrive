import { IconClock, IconMail, IconPhone, IconPin } from "../../storefront/storefront-icons";
import { Container } from "../../storefront/storefront-ui";
import type { RetailHomeModel } from "../model";
import { CtaLink } from "../parts/cta-link";

type ClosingData = NonNullable<RetailHomeModel["closing"]>;

/**
 * Clôture de page : l'appel à l'action et, à côté, tout ce qu'il faut
 * pour joindre ou trouver la boutique (adresse, téléphone, e-mail,
 * horaires — uniquement ceux que le commerçant a renseignés). Fusionne
 * l'ancien bandeau final et le bloc « contact » que le blueprint prévoit
 * mais que l'ancien template ne rendait pas : deux blocs de contact
 * consécutifs auraient été redondants.
 */
export function Closing({ data, organizationId }: { data: ClosingData; organizationId: string }) {
  const { info } = data;

  return (
    <section className="rt-closing" aria-labelledby="rt-closing-title">
      <Container className={info ? "rt-closing__grid" : "rt-closing__grid rt-closing__grid--solo"}>
        <div className="rt-closing__cta">
          <h2 id="rt-closing-title" className="rt-h2">
            {data.title}
          </h2>
          <p className="rt-lead">{data.lead}</p>
          {data.ctas.length > 0 && (
            <div className="rt-actions">
              {data.ctas.map((cta, index) => (
                <CtaLink
                  key={cta.href}
                  cta={cta}
                  organizationId={organizationId}
                  className={index === 0 ? "rt-btn rt-btn--accent" : "rt-btn rt-btn--outline-light"}
                />
              ))}
            </div>
          )}
        </div>

        {info && (
          <div className="rt-info">
            <h3 className="rt-info__title">{data.infoTitle}</h3>
            <ul className="rt-info__list">
              {info.address && (
                <li className="rt-info__row">
                  <IconPin className="rt-info__icon" />
                  <span>
                    {info.address}
                    {info.mapsHref && (
                      <>
                        {" "}
                        <a href={info.mapsHref} target="_blank" rel="noopener noreferrer" className="rt-info__link">
                          Voir sur la carte
                        </a>
                      </>
                    )}
                  </span>
                </li>
              )}
              {info.phone && (
                <li className="rt-info__row">
                  <IconPhone className="rt-info__icon" />
                  <a href={info.phoneHref ?? undefined} className="rt-info__link">
                    {info.phone}
                  </a>
                </li>
              )}
              {info.email && (
                <li className="rt-info__row">
                  <IconMail className="rt-info__icon" />
                  <a href={`mailto:${info.email}`} className="rt-info__link">
                    {info.email}
                  </a>
                </li>
              )}
            </ul>
            {info.hours.length > 0 && (
              <div className="rt-hours">
                <p className="rt-hours__title">
                  <IconClock className="rt-info__icon" />
                  Horaires
                </p>
                <dl className="rt-hours__list">
                  {info.hours.map(({ day, range }) => (
                    <div key={day} className="rt-hours__row">
                      <dt>{day}</dt>
                      <dd>{range}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        )}
      </Container>
    </section>
  );
}
