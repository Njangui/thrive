import { redirect } from "next/navigation";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";

export type MemberRole = "owner" | "admin" | "manager" | "sales" | "cashier" | "employee" | "accountant";

export interface CurrentMembership {
  userId: string;
  organizationId: string;
  role: MemberRole;
}

/**
 * Lit la session courante (cookies) et vérifie l'appartenance au tenant
 * ciblé. Retourne `null` plutôt que de lever si non authentifié/non membre
 * — c'est `requireMembership` qui décide de lever une erreur HTTP, pour
 * garder cette fonction réutilisable dans des contextes où l'absence de
 * session est un cas normal (ex: vérification optionnelle en Server Component).
 */
export async function getCurrentMembership(organizationId: string): Promise<CurrentMembership | null> {
  const supabase = await getSupabaseServerSessionClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error(`getCurrentMembership(${organizationId}) error:`, error.message);
    return null;
  }
  if (!data) return null;

  return { userId: user.id, organizationId, role: data.role as MemberRole };
}

/**
 * À appeler en tête de TOUTE route/server action admin (section 34/35).
 * Lève AuthenticationError (401) si pas de session, AuthorizationError
 * (403) si le rôle ne fait pas partie de `allowedRoles`. Ne remplace PAS
 * les policies RLS — c'est une seconde barrière explicite côté application,
 * comme demandé section 35 ("un utilisateur ne doit accéder qu'aux données
 * des entreprises auxquelles il appartient" — vérifié ici ET par RLS).
 */
export async function requireMembership(
  organizationId: string,
  allowedRoles?: MemberRole[],
): Promise<CurrentMembership> {
  const membership = await getCurrentMembership(organizationId);

  if (!membership) {
    throw new AuthenticationError();
  }
  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new AuthorizationError(
      `Rôle "${membership.role}" non autorisé pour cette action (requis: ${allowedRoles.join(", ")})`,
    );
  }

  return membership;
}

/**
 * Liste les organisations du user courant — nécessaire pour /dashboard,
 * qui ne se résout PAS par sous-domaine (contrairement à la vitrine
 * publique) mais par appartenance : un admin se connecte sur un domaine
 * applicatif unique, pas forcément sur le sous-domaine de son entreprise.
 */
export async function getCurrentUserOrganizations(): Promise<
  { organizationId: string; organizationName: string; role: MemberRole }[]
> {
  const supabase = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("memberships")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", user.id);

  if (error) {
    console.error("getCurrentUserOrganizations error:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    organizationId: row.organization_id,
    organizationName: (row as unknown as { organizations?: { name?: string } }).organizations?.name ?? "",
    role: row.role as MemberRole,
  }));
}

/**
 * Helper utilisé par toutes les pages `/dashboard/*` : évite de refaire le
 * `orgs[0] ?? ...` (avec `noUncheckedIndexedAccess`, un accès de tableau
 * est toujours `T | undefined`) dans chaque page. Redirige vers
 * l'onboarding si l'utilisateur n'a encore aucune organisation — filet de
 * sécurité, le layout dashboard le fait déjà normalement.
 */
export async function requireCurrentOrganization(): Promise<{
  organizationId: string;
  organizationName: string;
  role: MemberRole;
}> {
  const orgs = await getCurrentUserOrganizations();
  const org = orgs[0];
  if (!org) {
    redirect("/onboarding");
  }
  return org;
}
