import { IconPhone, IconPin, IconWhatsapp } from "../../storefront/storefront-icons";
import { buildGoogleMapsSearchUrl } from "../../landing-sections/contact";
import { HoursTable } from "../hours-client";
import type { HoursEntry, RestaurantHomeModel } from "../restaurant-model";
import { CtaLink } from "../restaurant-ui";

/**
 * Réserver + informations pratiques. `id="infos"` est la cible du lien
 * « horaires » de la barre du hero.
 *
 * Les moyens de réserver viennent du modèle (page de réservation en ligne si
 * l'offre du commerçant l'inclut, sinon WhatsApp, sinon téléphone) : le texte
 * ne promet jamais un canal qui n'existe pas.
 */
export function VisitSection({
  visit,
  hours,
  organizationId,
}: {
  visit: NonNullable<RestaurantHomeModel["visit"]>;
  hours: HoursEntry[];
  organizationId: string;
}) {
  const hasContact = Boolean(visit.address || visit.phone || visit.whatsappHref);
  const hasDetails = hours.length > 0 || hasContact;

  return (
    <section id="infos" className="rl-section rl-section--tint" aria-labelledby="rl-visit-title">
      <div className={`rl-wrap rl-visit${hasDetails ? "" : " rl-visit--solo"}`}>
        <div className="rl-visit__intro">
          <h2 id="rl-visit-title" className="rl-h2">
            {visit.heading}
          </h2>
          {visit.lead && <p className="rl-lead">{visit.lead}</p>}
          <div className="rl-visit__actions">
            {visit.action && <CtaLink action={visit.action} variant="accent" ctaId="visit_primary" organizationId={organizationId} />}
            {visit.address && (
              <a className="rl-btn rl-btn--outline" href={buildGoogleMapsSearchUrl(visit.address)} target="_blank" rel="noopener noreferrer">
                Itinéraire
              </a>
            )}
          </div>
        </div>

        {hasDetails && (
          <div className="rl-visit__details">
            {hours.length > 0 && (
              <div className="rl-visit__block">
                <h3 className="rl-h3">Horaires</h3>
                <HoursTable entries={hours} />
              </div>
            )}

            {hasContact && (
              <div className="rl-visit__block">
                <h3 className="rl-h3">Nous trouver</h3>
                <ul className="rl-contact">
                  {visit.address && (
                    <li>
                      <IconPin className="rl-contact__icon" />
                      <a href={buildGoogleMapsSearchUrl(visit.address)} target="_blank" rel="noopener noreferrer">
                        {visit.address}
                      </a>
                    </li>
                  )}
                  {visit.phone && (
                    <li>
                      <IconPhone className="rl-contact__icon" />
                      <a href={visit.phone.href}>{visit.phone.text}</a>
                    </li>
                  )}
                  {visit.whatsappHref && (
                    <li>
                      <IconWhatsapp className="rl-contact__icon" />
                      <a href={visit.whatsappHref} target="_blank" rel="noopener noreferrer">
                        Écrire sur WhatsApp
                      </a>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
