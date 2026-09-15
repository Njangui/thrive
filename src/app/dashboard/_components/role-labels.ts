import type { MemberRole } from "@/application/services/auth-service";

/** Partagé entre `topbar.tsx` et `layout.tsx` (sept. 2026) — évite deux
 * définitions divergentes du même libellé. Reprend `ROLE_LABELS` de
 * `team/page.tsx` (source de vérité pour ce wording côté équipe). */
export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  manager: "Manager",
  sales: "Vente",
  cashier: "Caisse",
  employee: "Employé",
  accountant: "Comptable",
};
