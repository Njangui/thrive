import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import type { AffiliateStatus } from "@/domain/entities/affiliate";

/**
 * Garde d'accès du portail `/affiliate/*` — même mécanique en deux temps
 * que `requirePlatformAdmin()`
 * (application/services/platform-admin-service.ts) : session cookie pour
 * savoir QUI, puis lecture service-role de `affiliates` (RLS de cette
 * table restreint déjà un affilié à sa propre ligne, mais le layout/les
 * Server Actions ont besoin de lire le statut AVANT que la session
 * "authenticated" normale ne s'applique correctement dans certains
 * contextes serveur — même raisonnement que platform-admin-service.ts).
 *
 * ENTIÈREMENT séparé de `requireMembership()`/`requirePlatformAdmin()` :
 * un affilié n'est ni membre d'une organisation tenant, ni un Super
 * Admin plateforme — c'est un troisième rôle, avec sa propre table et
 * son propre portail.
 */

export interface CurrentAffiliate {
  id: string;
  userId: string;
  status: AffiliateStatus;
  displayName: string;
}

export async function getCurrentAffiliate(): Promise<CurrentAffiliate | null> {
  const sessionClient = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) return null;

  const serviceClient = getSupabaseServiceClient();
  const { data, error } = await serviceClient
    .from("affiliates")
    .select("id, status, display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("getCurrentAffiliate error:", error.message);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    userId: user.id,
    status: data.status as AffiliateStatus,
    displayName: data.display_name,
  };
}

/**
 * À appeler en tête de toute page/Server Action de `/affiliate/dashboard/*`.
 * Lève `AuthenticationError` (401) si pas de session, `AuthorizationError`
 * (403) si l'utilisateur n'a pas (encore, ou plus) de compte affilié
 * `active` — un statut `pending`/`rejected`/`suspended` ne donne PAS accès
 * au tableau de bord (mais reste visible sur /affiliate/apply pour
 * connaître son statut de candidature).
 */
export async function requireAffiliate(): Promise<CurrentAffiliate> {
  const affiliate = await getCurrentAffiliate();
  if (!affiliate) {
    throw new AuthenticationError("Connectez-vous avec le compte utilisé pour votre candidature d'affiliation.");
  }
  if (affiliate.status !== "active") {
    throw new AuthorizationError(
      affiliate.status === "pending"
        ? "Votre candidature est en cours d'examen."
        : "Votre compte affilié n'est pas actif.",
    );
  }
  return affiliate;
}
