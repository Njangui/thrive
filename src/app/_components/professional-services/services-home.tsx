import type { CSSProperties } from "react";
import { buildProfessionalServicesHomeModel, type ProfessionalServicesHomeInput } from "./services-model";
import { ServicesHero } from "./sections/hero";
import { OfferingsSection } from "./sections/offerings";
import { DomainsSection } from "./sections/domains";
import { AboutSection } from "./sections/about";
import { TeamSection } from "./sections/team";
import { TestimonialsSection } from "./sections/testimonials";
import { VisitSection } from "./sections/visit";
import "./services-home.css";

/**
 * Page d'accueil du template PRESTATAIRE DE SERVICE.
 *
 * Même organisation que le template restaurant (voir
 * `restaurant/restaurant-home.tsx`) :
 *
 *   services-model.ts     ce qu'on affiche et pourquoi (fonctions pures, testées)
 *   services-home.css     tout le style, préfixé `ps-`, une seule feuille
 *   sections/*.tsx         une section = un fichier
 *   services-ui.tsx        briques partagées (bouton, titre, prix, ligne, étoiles)
 *   hours-client.tsx       seul composant client : le jour courant dans le navigateur
 *
 * Chaque section n'existe que si elle a du contenu réel (ou d'exemple
 * signalé comme tel) : le modèle renvoie `null` sinon.
 */
export function ProfessionalServicesHome(input: ProfessionalServicesHomeInput) {
  const model = buildProfessionalServicesHomeModel(input);
  const organizationId = input.site.tenant.organizationId;

  const themeStyle = model.theme
    ? ({ "--ps-on-accent": model.theme.onAccent, "--ps-accent-ink": model.theme.ink } as CSSProperties)
    : undefined;

  return (
    <div className="ps" style={themeStyle}>
      <ServicesHero model={model} organizationId={organizationId} />
      {model.offerings && <OfferingsSection offerings={model.offerings} />}
      {model.domains && <DomainsSection domains={model.domains} />}
      {model.about && <AboutSection about={model.about} />}
      {model.team && <TeamSection team={model.team} />}
      {model.testimonials && <TestimonialsSection testimonials={model.testimonials} />}
      {model.visit && <VisitSection visit={model.visit} hours={model.hours} organizationId={organizationId} />}
    </div>
  );
}
