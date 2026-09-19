import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";

export interface PlatformAdmin {
  userId: string;
  role: string;
  /**
   * Repasse design console admin : ajouté pour alimenter le badge
   * d'identité de la topbar (`AdminTopbar`) sans requête supplémentaire —
   * `user.email` est déjà disponible sur l'objet retourné par
   * `auth.getUser()` juste en dessous, jamais interrogé nulle part
   * ailleurs dans cette fonction avant ce lot.
   */
  email: string | null;
}

/**
 * Lot C — À appeler en tête de CHAQUE route/page `/admin/*`, sans
 * exception (y compris chaque Server Action mutante, indépendamment du
 * fait que le layout parent l'ait déjà fait — un Server Action reste un
 * point d'entrée HTTP à part entière, pas protégé par le rendu de page
 * qui l'entoure). Entièrement séparé de `requireMembership()`
 * (auth-service.ts) : la console Super Admin n'est pas scopée à une
 * organisation, donc pas question de réutiliser `is_member_of_org()`.
 *
 * Vérification en 2 temps :
 *  1. Session utilisateur (cookies) via le client "session" — pour
 *     savoir QUI fait la requête.
 *  2. Appartenance à `platform_admins` via le client service-role —
 *     cette table n'a AUCUNE policy RLS pour un client authentifié
 *     normal (migration 0015), donc une lecture via le client "session"
 *     renverrait toujours zéro ligne. Le service-role est nécessaire
 *     ici et c'est voulu : c'est la seule couche de code autorisée à
 *     poser la question "cet utilisateur est-il admin ?".
 *
 * Lève `AuthenticationError` si pas de session, `AuthorizationError` si
 * la session existe mais l'utilisateur n'est pas dans `platform_admins`
 * (y compris en cas d'erreur DB inattendue — on ne transforme jamais une
 * erreur en accès admin par défaut, cette surface est la plus sensible
 * du projet).
 */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const sessionClient = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    throw new AuthenticationError();
  }

  const admin = await getPlatformAdminStatus(user.id, user.email ?? null);
  if (!admin) {
    throw new AuthorizationError();
  }

  return admin;
}

/**
 * Variante non bloquante de `requirePlatformAdmin()` — pour un affichage
 * conditionnel (ex : lien "Console Admin" dans la nav du dashboard
 * marchand, visible uniquement pour un `platform_admins`, voir
 * `dashboard/layout.tsx`) plutôt qu'une garde qui doit lever une erreur.
 * Ne remplace `requirePlatformAdmin()` nulle part : la protection réelle
 * de `/admin/*` reste cette dernière (et son appel dans chaque route),
 * jamais une simple absence/présence de lien dans la nav (voir sa note :
 * un lien masqué n'est qu'un confort UI, pas une barrière de sécurité).
 *
 * Retourne `null` — jamais une erreur — en cas d'absence de ligne
 * `platform_admins` OU d'erreur DB inattendue, exactement le même parti
 * pris que `requirePlatformAdmin()` : ne jamais transformer une erreur en
 * accès admin par défaut sur la surface la plus sensible du projet.
 */
export async function getPlatformAdminStatus(userId: string, email: string | null = null): Promise<PlatformAdmin | null> {
  const serviceClient = getSupabaseServiceClient();
  const { data, error } = await serviceClient
    .from("platform_admins")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("getPlatformAdminStatus: erreur lecture platform_admins:", error.message);
    return null;
  }

  if (!data) {
    return null;
  }

  return { userId, role: data.role as string, email };
}
