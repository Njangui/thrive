import type { TeamMember } from "@/application/services/landing-config-service";
import type { MemberRole } from "@/application/services/auth-service";

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

export function TeamSection({ members }: { members: TeamMember[] }) {
  if (members.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold">Notre équipe</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {members.map((member) => {
          const displayName = member.fullName ?? ROLE_LABELS[member.role];
          return (
            <div key={member.userId} className="flex flex-col items-center gap-2 text-center">
              {member.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={member.avatarUrl}
                  alt={displayName}
                  className="h-16 w-16 rounded-full border border-ink/10 object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-ink/10 bg-brand/10 font-display text-sm font-semibold text-brand">
                  {initials(displayName)}
                </div>
              )}
              <div>
                <p className="text-sm font-medium">{displayName}</p>
                {member.fullName && <p className="text-xs text-muted">{ROLE_LABELS[member.role]}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
