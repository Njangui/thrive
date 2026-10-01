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
 * Email de session de l'acteur courant — utilisé par les flows de
 * paiement (Lot G : initiatePayment / purchaseAddon) qui doivent
 * transmettre un identifiant de contact au provider de paiement actif
 * (Fapshi). Toujours disponible via Supabase Auth (contrairement à un
 * numéro de téléphone), donc pas de valeur de repli à gérer côté
 * appelant.
 */
export async function getCurrentUserEmail(): Promise<string | null> {
  const supabase = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
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
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

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

/** Cookie mémorisant l'entreprise choisie par un utilisateur qui en a plusieurs. */
export const ACTIVE_ORG_COOKIE = "flexco_active_org";

/**
 * Pure : l'entreprise préférée si l'utilisateur en est bien membre (le
 * cookie ne peut JAMAIS donner accès à une entreprise dont on n'est pas
 * membre : on ne choisit que parmi `orgs`, déjà filtrées par RLS), sinon la
 * plus ancienne appartenance (ordre déterministe).
 */
export function pickCurrentOrganization<T extends { organizationId: string }>(orgs: T[], preferredId?: string | null): T | undefined {
  return (preferredId ? orgs.find((o) => o.organizationId === preferredId) : undefined) ?? orgs[0];
}

async function readActiveOrgCookie(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    return (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null;
  } catch {
    return null; // hors contexte de requête
  }
}

/** Entreprise courante de l'utilisateur, ou null s'il n'en a aucune. */
export async function getCurrentOrganizationOrNull(): Promise<
  { organizationId: string; organizationName: string; role: MemberRole } | null
> {
  const orgs = await getCurrentUserOrganizations();
  return pickCurrentOrganization(orgs, await readActiveOrgCookie()) ?? null;
}

/**
 * Helper utilisé par toutes les pages `/dashboard/*`. Avant : toujours la
 * 1re appartenance, sans tri ni choix possible — un utilisateur membre de
 * plusieurs entreprises (ex. une gratuite de test + une payante) voyait une
 * entreprise arbitraire, donc parfois « Discover » alors que son entreprise
 * payante était une autre. Redirige vers l'onboarding si aucune entreprise.
 */
export async function requireCurrentOrganization(): Promise<{
  organizationId: string;
  organizationName: string;
  role: MemberRole;
}> {
  const org = await getCurrentOrganizationOrNull();
  if (!org) {
    redirect("/onboarding");
  }
  return org;
}
