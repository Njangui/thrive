import { StorefrontImage } from "../../storefront/storefront-image";
import type { ProfessionalServicesHomeModel } from "../services-model";
import { SectionHead } from "../services-ui";

/**
 * L'équipe : nom et photo uniquement — jamais `member.role` tel quel. Ce
 * champ est le rôle d'ACCÈS interne au tableau de bord (owner, admin,
 * cashier, employee...), pas un intitulé de poste ; l'afficher tel quel
 * montrerait « cashier » ou « owner » à un visiteur (voir la note en tête de
 * `services-model.ts`). Sans intitulé de poste réel dans les données, on
 * n'en invente pas.
 */
export function TeamSection({ team }: { team: NonNullable<ProfessionalServicesHomeModel["team"]> }) {
  return (
    <section className="ps-section ps-section--tint" aria-labelledby="ps-team-title">
      <div className="ps-wrap">
        <SectionHead id="ps-team-title" title={team.heading} />
        <ul className="ps-team">
          {team.items.map((member) => (
            <li key={member.id} className="ps-team__card">
              <span className="ps-team__photo">
                {member.avatarUrl ? (
                  <StorefrontImage src={member.avatarUrl} alt="" sizes="180px" fallbackLabel="" />
                ) : (
                  <span className="ps-team__initial" aria-hidden="true">
                    {member.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="ps-team__name">{member.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
