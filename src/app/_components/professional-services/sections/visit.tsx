import { IconMail, IconPhone, IconPin, IconWhatsapp } from "../../storefront/storefront-icons";
import { buildGoogleMapsSearchUrl } from "../../landing-sections/contact";
import { HoursTable } from "../hours-client";
import type { ProfessionalServicesHomeModel } from "../services-model";
import type { HoursEntry } from "../../sector-shared/business-hours";
import { CtaLink } from "../services-ui";

/** Demander un rendez-vous + informations pratiques. `id="infos"` est la cible du lien « horaires » de la barre du hero. */
export function VisitSection({
  visit,
  hours,
  organizationId,
}: {
  visit: NonNullable<ProfessionalServicesHomeModel["visit"]>;
  hours: HoursEntry[];
  organizationId: string;
}) {
  const hasContact = Boolean(visit.address || visit.phone || visit.email || visit.whatsappHref);
  const hasDetails = hours.length > 0 || hasContact;

  return (
    <section id="infos" className="ps-section ps-section--tint" aria-labelledby="ps-visit-title">
      <div className={`ps-wrap ps-visit${hasDetails ? "" : " ps-visit--solo"}`}>
        <div className="ps-visit__intro">
          <h2 id="ps-visit-title" className="ps-h2">
            {visit.heading}
          </h2>
          {visit.lead && <p className="ps-lead">{visit.lead}</p>}
          {visit.action && (
            <div className="ps-visit__actions">
              <CtaLink action={visit.action} variant="accent" ctaId="visit_primary" organizationId={organizationId} />
            </div>
          )}
        </div>

        {hasDetails && (
          <div className="ps-visit__details">
            {hours.length > 0 && (
              <div className="ps-visit__block">
                <h3 className="ps-h3">Horaires</h3>
                <HoursTable entries={hours} />
              </div>
            )}

            {hasContact && (
              <div className="ps-visit__block">
                <h3 className="ps-h3">{visit.locationHeading}</h3>
                <ul className="ps-contact">
                  {visit.address && (
                    <li>
                      <IconPin className="ps-contact__icon" />
                      <a href={buildGoogleMapsSearchUrl(visit.address)} target="_blank" rel="noopener noreferrer">
                        {visit.address}
                      </a>
                    </li>
                  )}
                  {visit.phone && (
                    <li>
                      <IconPhone className="ps-contact__icon" />
                      <a href={visit.phone.href}>{visit.phone.text}</a>
                    </li>
                  )}
                  {visit.email && (
                    <li>
                      <IconMail className="ps-contact__icon" />
                      <a href={visit.email.href}>{visit.email.text}</a>
                    </li>
                  )}
                  {visit.whatsappHref && (
                    <li>
                      <IconWhatsapp className="ps-contact__icon" />
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
