import type { TeamMember } from "@/application/services/landing-config-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import type { MemberRole } from "@/application/services/auth-service";
import { sectionHeading } from "@/application/config/storefront-blueprint";
import { Section, SectionHeading } from "../storefront/storefront-ui";

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Propriétaire",
  admin: "Administrateur·rice",
  manager: "Responsable",
  sales: "Vente",
  cashier: "Caisse",
  employee: "Membre de l'équipe",
  accountant: "Comptabilité",
};

function initials(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * NOTE DE DONNÉES (inchangée depuis le Lot K, toujours vraie) :
 * `profiles.full_name` et `profiles.avatar_url` ne sont écrits par aucun
 * écran de ce projet — en pratique tous les membres remontent donc sans
 * nom ni photo, et le repli sur le libellé de rôle est le rendu NORMAL,
 * pas un cas limite. C'est aussi pourquoi `getStorefrontCapabilities`
 * exige au moins deux membres avant d'exposer cette section : « Notre
 * équipe : Propriétaire » n'apprend rien à personne.
 */
export function TeamSection({ members, site }: { members: TeamMember[]; site: StorefrontSite }) {
  if (members.length === 0) return null;

  return (
    <Section>
      <SectionHeading
        title={sectionHeading(site.blueprint, "team", "Notre équipe")}
        subtitle={site.blueprint.subheadings.team ?? null}
      />
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
        {members.map((member) => {
          const displayName = member.fullName ?? ROLE_LABELS[member.role];
          return (
            <div key={member.userId} className="flex flex-col items-center gap-2 text-center">
              {member.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatar pouvant être hébergé hors de nos domaines autorisés
                <img
                  src={member.avatarUrl}
                  alt={displayName}
                  className="h-20 w-20 rounded-full border border-black/[0.08] object-cover"
                />
              ) : (
                <div
                  aria-hidden
                  className="grid h-20 w-20 place-items-center rounded-full border border-black/[0.08] bg-[var(--brand-soft,rgba(0,0,0,.04))] font-display text-lg font-bold text-brand"
                >
                  {initials(displayName)}
                </div>
              )}
              <div>
                <p className="text-sm font-semibold">{displayName}</p>
                {member.fullName && <p className="text-xs text-black/50">{ROLE_LABELS[member.role]}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
