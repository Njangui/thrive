import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { requireMembership } from "./auth-service";
import { AuthorizationError } from "@/lib/errors";

/**
 * Droits du site (C4). Le rôle reste la source principale ; le propriétaire
 * peut en plus accorder à n'importe quel membre la permission
 * `publish_site` (memberships.extra_permissions = {"publish_site": true}).
 * Même règle en SQL : fonction `can_publish_site` (migration 0162).
 */
export const SITE_PUBLISH_PERMISSION = "publish_site";

const EDITOR_ROLES = ["owner", "admin", "manager"] as const;
const PUBLISHER_ROLES = ["owner", "admin"] as const;

/** Seule la valeur booléenne `true` accorde le droit (pas "true", 1, ni un objet). */
export function hasSitePublishRight(role: string, extraPermissions: unknown): boolean {
  if ((PUBLISHER_ROLES as readonly string[]).includes(role)) return true;
  if (extraPermissions === null || typeof extraPermissions !== "object" || Array.isArray(extraPermissions)) return false;
  return (extraPermissions as Record<string, unknown>)[SITE_PUBLISH_PERMISSION] === true;
}

export function canEditSiteDraft(role: string, extraPermissions: unknown): boolean {
  return (EDITOR_ROLES as readonly string[]).includes(role) || hasSitePublishRight(role, extraPermissions);
}

async function loadExtraPermissions(organizationId: string, userId: string): Promise<unknown> {
  const { data, error } = await getSupabaseServiceClient()
    .from("memberships")
    .select("extra_permissions")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Lecture des permissions impossible: ${error.message}`);
  return data?.extra_permissions ?? {};
}

/** Exige le droit de MODIFIER le brouillon du site. Retourne l'acteur vérifié. */
export async function requireSiteEditor(organizationId: string) {
  const membership = await requireMembership(organizationId);
  const extra = await loadExtraPermissions(organizationId, membership.userId);
  if (!canEditSiteDraft(membership.role, extra)) {
    throw new AuthorizationError("Vous n'avez pas le droit de modifier le site.");
  }
  return membership;
}

/** Exige le droit de PUBLIER (ou restaurer) le site : owner, admin, ou permission accordée par le propriétaire. */
export async function requireSitePublisher(organizationId: string) {
  const membership = await requireMembership(organizationId);
  const extra = await loadExtraPermissions(organizationId, membership.userId);
  if (!hasSitePublishRight(membership.role, extra)) {
    throw new AuthorizationError("Vous n'avez pas le droit de publier le site. Demandez au propriétaire de vous l'accorder.");
  }
  return membership;
}

/** Droits de l'utilisateur courant sur le site (pour afficher ou masquer les boutons ; l'application des droits reste dans les services). */
export async function getSitePermissions(organizationId: string): Promise<{ canEdit: boolean; canPublish: boolean }> {
  const membership = await requireMembership(organizationId);
  const extra = await loadExtraPermissions(organizationId, membership.userId);
  return {
    canEdit: canEditSiteDraft(membership.role, extra),
    canPublish: hasSitePublishRight(membership.role, extra),
  };
}
