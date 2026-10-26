import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { AuthenticationError } from "@/lib/errors";
import { getCurrentOrganizationOrNull, requireMembership, type MemberRole } from "@/application/services/auth-service";
import { normalizeExtraPermissions, type AgentActor } from "./actor";

/**
 * Acteur d'une session dashboard. organizationId/userId viennent de la SESSION ;
 * on relit le membership (id, rôle courant, permissions), filtré par organisation
 * ET utilisateur (jamais de service-role sans filtre : principe 5).
 */
export async function buildDashboardActor(
  input: { organizationId: string; userId: string },
  db: SupabaseClient = getSupabaseServiceClient(),
): Promise<AgentActor> {
  const { data, error } = await db
    .from("memberships")
    .select("id, role, extra_permissions")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) throw new Error(`Acteur dashboard: lecture du membership impossible: ${error.message}`);
  if (!data) throw new AuthenticationError();
  return {
    userId: input.userId,
    tenantId: input.organizationId,
    membershipId: data.id as string,
    role: data.role as MemberRole, // le rôle relu en base fait foi
    extraPermissions: normalizeExtraPermissions(data.extra_permissions),
    channel: "dashboard",
  };
}

/** Pour les route handlers : entreprise courante + acteur. */
export async function requireDashboardActor(): Promise<AgentActor> {
  const org = await getCurrentOrganizationOrNull();
  if (!org) throw new AuthenticationError();
  const membership = await requireMembership(org.organizationId);
  return buildDashboardActor({ organizationId: org.organizationId, userId: membership.userId });
}
