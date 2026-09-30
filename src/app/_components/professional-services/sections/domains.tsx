import type { ProfessionalServicesHomeModel } from "../services-model";
import { MenuLine, SectionHead } from "../services-ui";

/**
 * Domaines d'intervention — calculés par le modèle à partir des VRAIS
 * services (voir la note en tête de `services-model.ts`). Lien général vers
 * la page des services : celle-ci regroupe déjà les prestations par domaine,
 * mais n'offre pas de filtre par URL, donc pas de lien direct par domaine.
 */
export function DomainsSection({ domains }: { domains: NonNullable<ProfessionalServicesHomeModel["domains"]> }) {
  return (
    <section className="ps-section ps-section--tint" aria-labelledby="ps-domains-title">
      <div className="ps-wrap">
        <SectionHead id="ps-domains-title" title={domains.heading} />
        <ul className="ps-domains">
          {domains.items.map((domain) => (
            <li key={domain.name} className="ps-domains__item">
              <MenuLine label={domain.name} value={domain.countLabel} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
