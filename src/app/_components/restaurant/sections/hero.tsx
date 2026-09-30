import { IconPhone, IconPin, IconWhatsapp } from "../../storefront/storefront-icons";
import { StorefrontImage } from "../../storefront/storefront-image";
import { buildGoogleMapsSearchUrl } from "../../landing-sections/contact";
import { TodayHours } from "../hours-client";
import type { RestaurantHomeModel } from "../restaurant-model";
import { CtaLink, Stars, formatAverage } from "../restaurant-ui";

/**
 * Hero : le nom du restaurant en grand sur sa photo, deux boutons, puis la
 * barre d'infos pratiques (adresse, horaires du jour, téléphone).
 *
 * Le titre est le nom réel de l'établissement tant que le commerçant n'a pas
 * saisi son propre titre — jamais une formule générique. La barre d'infos est
 * dans le hero et non plus bas : c'est ce qu'un visiteur mobile cherche en
 * premier (où, quand, comment appeler), avant même la carte.
 */
export function RestaurantHero({ model, organizationId }: { model: RestaurantHomeModel; organizationId: string }) {
  const { hero, dock, hours, hoursSummary } = model;
  // Sans photo, ou sans rien d'autre qu'un titre (commerce tout juste créé), le hero
  // ne garde pas la hauteur d'un écran : il n'aurait que du vide à montrer.
  const isBare = !hero.primary && !hero.secondary && !hero.lead && dock.length === 0;
  const heroClass = ["rl-hero", hero.imageUrl ? "" : "rl-hero--plain", isBare ? "rl-hero--bare" : ""].filter(Boolean).join(" ");

  return (
    <section className={heroClass} aria-labelledby="rl-hero-title">
      <div className="rl-hero__media" aria-hidden="true">
        {hero.imageUrl && <StorefrontImage src={hero.imageUrl} alt="" sizes="100vw" priority fallbackLabel="" />}
      </div>
      <div className="rl-hero__scrim" aria-hidden="true" />

      <div className="rl-wrap rl-hero__body">
        <h1 id="rl-hero-title" className={`rl-hero__title${hero.isLongTitle ? " rl-hero__title--long" : ""}`}>
          {hero.title}
        </h1>
        {hero.lead && <p className="rl-hero__lead">{hero.lead}</p>}

        {(hero.primary || hero.secondary) && (
          <div className="rl-hero__actions">
            {hero.primary && <CtaLink action={hero.primary} variant="light" ctaId="hero_primary" organizationId={organizationId} />}
            {hero.secondary && <CtaLink action={hero.secondary} variant="ghost" ctaId="hero_secondary" organizationId={organizationId} />}
          </div>
        )}

        {hero.rating && (
          <p className="rl-hero__rating">
            <Stars rating={hero.rating.average} label={`Note moyenne : ${formatAverage(hero.rating.average)} sur 5`} />
            <span>
              {formatAverage(hero.rating.average)} sur 5
              <span className="rl-hero__rating-count">
                {" "}
                ({hero.rating.count} {hero.rating.count > 1 ? "avis notés" : "avis noté"})
              </span>
            </span>
          </p>
        )}
      </div>

      {dock.length > 0 && (
        <div className="rl-wrap">
          <ul className="rl-dock" aria-label="Informations pratiques">
            {dock.map((item) => {
              switch (item.kind) {
                case "address":
                  return (
                    <li key="address" className="rl-dock__item">
                      <a className="rl-dock__link" href={buildGoogleMapsSearchUrl(item.text)} target="_blank" rel="noopener noreferrer">
                        <IconPin className="rl-dock__icon" />
                        <span className="rl-sr">Adresse : </span>
                        <span>{item.text}</span>
                      </a>
                    </li>
                  );
                case "hours":
                  return (
                    <li key="hours" className="rl-dock__item">
                      <TodayHours entries={hours} summary={hoursSummary} />
                    </li>
                  );
                case "phone":
                  return (
                    <li key="phone" className="rl-dock__item">
                      <a className="rl-dock__link" href={item.href}>
                        <IconPhone className="rl-dock__icon" />
                        <span className="rl-sr">Téléphone : </span>
                        <span>{item.text}</span>
                      </a>
                    </li>
                  );
                case "whatsapp":
                  return (
                    <li key="whatsapp" className="rl-dock__item">
                      <a className="rl-dock__link" href={item.href} target="_blank" rel="noopener noreferrer">
                        <IconWhatsapp className="rl-dock__icon" />
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
