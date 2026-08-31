import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";

export interface PlatformAdmin {
  userId: string;
  role: string;
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

  const serviceClient = getSupabaseServiceClient();
  const { data, error } = await serviceClient
    .from("platform_admins")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("requirePlatformAdmin: erreur lecture platform_admins:", error.message);
    throw new AuthorizationError();
  }

  if (!data) {
    throw new AuthorizationError();
  }

  return { userId: user.id, role: data.role as string };
}
