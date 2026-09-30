import { HighlightIcon, IconMail, IconPhone, IconPin, IconWhatsapp } from "../../storefront/storefront-icons";
import { StorefrontImage } from "../../storefront/storefront-image";
import { buildGoogleMapsSearchUrl } from "../../landing-sections/contact";
import { TodayHours } from "../hours-client";
import type { ProfessionalServicesHomeModel } from "../services-model";
import { CtaLink, Stars, formatAverage } from "../services-ui";

/**
 * Hero : titre, sous-titre fonctionnel, deux boutons, note moyenne si des
 * avis existent, jusqu'à 3 promesses (`site.highlights` — texte du
 * commerçant s'il les a personnalisées, sinon repli du secteur filtré par
 * capacité réelle), puis la barre d'infos pratiques.
 *
 * Pas de photo imposée par défaut (contrairement au restaurant) : un cabinet
 * de conseil, un avocat ou une agence n'ont pas de photo "type" universelle
 * comme un plat en a une. Sans photo réelle, le hero reste un panneau sobre
 * dans les couleurs de la marque plutôt qu'une image générique qui ne
 * représenterait pas l'activité réelle du commerçant.
 */
export function ServicesHero({ model, organizationId }: { model: ProfessionalServicesHomeModel; organizationId: string }) {
  const { hero, dock, hours, hoursSummary } = model;
  const isBare = !hero.primary && !hero.secondary && !hero.lead && hero.trust.length === 0 && dock.length === 0;
  const heroClass = ["ps-hero", hero.imageUrl ? "" : "ps-hero--plain", isBare ? "ps-hero--bare" : ""].filter(Boolean).join(" ");

  return (
    <section className={heroClass} aria-labelledby="ps-hero-title">
      {hero.imageUrl && (
        <>
          <div className="ps-hero__media" aria-hidden="true">
            <StorefrontImage src={hero.imageUrl} alt="" sizes="100vw" priority fallbackLabel="" />
          </div>
          <div className="ps-hero__scrim" aria-hidden="true" />
        </>
      )}

      <div className="ps-wrap ps-hero__body">
        <h1 id="ps-hero-title" className={`ps-hero__title${hero.isLongTitle ? " ps-hero__title--long" : ""}`}>
          {hero.title}
        </h1>
        {hero.lead && <p className="ps-hero__lead">{hero.lead}</p>}

        {(hero.primary || hero.secondary) && (
          <div className="ps-hero__actions">
            {hero.primary && <CtaLink action={hero.primary} variant="accent" ctaId="hero_primary" organizationId={organizationId} />}
            {hero.secondary && <CtaLink action={hero.secondary} variant="outline" ctaId="hero_secondary" organizationId={organizationId} />}
          </div>
        )}

        {hero.rating && (
          <p className="ps-hero__rating">
            <Stars rating={hero.rating.average} label={`Note moyenne : ${formatAverage(hero.rating.average)} sur 5`} />
            <span>
              {formatAverage(hero.rating.average)} sur 5
              <span className="ps-hero__rating-count">
                {" "}
                ({hero.rating.count} {hero.rating.count > 1 ? "avis notés" : "avis noté"})
              </span>
            </span>
          </p>
        )}

        {hero.trust.length > 0 && (
          <ul className="ps-trust">
            {hero.trust.map((item) => (
              <li key={item.title} className="ps-trust__item">
                <HighlightIcon name={item.icon} className="ps-trust__icon" />
                <span>{item.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dock.length > 0 && (
        <div className="ps-wrap">
          <ul className="ps-dock" aria-label="Informations pratiques">
            {dock.map((item) => {
              switch (item.kind) {
                case "address":
                  return (
                    <li key="address" className="ps-dock__item">
                      <a className="ps-dock__link" href={buildGoogleMapsSearchUrl(item.text)} target="_blank" rel="noopener noreferrer">
                        <IconPin className="ps-dock__icon" />
                        <span className="ps-sr">Adresse : </span>
                        <span>{item.text}</span>
                      </a>
                    </li>
                  );
                case "hours":
                  return (
                    <li key="hours" className="ps-dock__item">
                      <TodayHours entries={hours} summary={hoursSummary} />
                    </li>
                  );
                case "phone":
                  return (
                    <li key="phone" className="ps-dock__item">
                      <a className="ps-dock__link" href={item.href}>
                        <IconPhone className="ps-dock__icon" />
                        <span className="ps-sr">Téléphone : </span>
                        <span>{item.text}</span>
                      </a>
                    </li>
                  );
                case "email":
                  return (
                    <li key="email" className="ps-dock__item">
                      <a className="ps-dock__link" href={item.href}>
                        <IconMail className="ps-dock__icon" />
                        <span className="ps-sr">Email : </span>
                        <span>{item.text}</span>
                      </a>
                    </li>
                  );
                case "whatsapp":
                  return (
                    <li key="whatsapp" className="ps-dock__item">
                      <a className="ps-dock__link" href={item.href} target="_blank" rel="noopener noreferrer">
                        <IconWhatsapp className="ps-dock__icon" />
                        <span>Écrire sur WhatsApp</span>
                      </a>
                    </li>
                  );
              }
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
