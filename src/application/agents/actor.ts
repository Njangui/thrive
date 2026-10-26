/**
 * Un outil n'est jamais exécutable sans acteur valide. L'acteur est construit
 * par la couche d'identité du canal (C2) ou le planificateur (C1), JAMAIS à
 * partir du contenu d'un message.
 */
import { z } from "zod";
import type { Actor, Channel, Role } from "./contracts";
import { AgentError } from "./errors";
import { ALL_ROLES } from "./role-matrix";

export const ActorSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  membershipId: z.string().min(1).optional(),
  role: z.enum(ALL_ROLES as [Role, ...Role[]]),
  extraPermissions: z.array(z.string()),
  channel: z.enum(["dashboard", "telegram", "whatsapp", "scheduler", "customer"]),
});

export function assertActor(value: unknown): Actor {
  const parsed = ActorSchema.safeParse(value);
  if (!parsed.success) {
    throw new AgentError("actor_required", "Acteur absent ou invalide : aucun outil n'est exécutable sans acteur");
  }
  return parsed.data;
}

/** `memberships.extra_permissions` (jsonb `{ "manage_ai": true }`) -> clés à `true`. */
export function extraPermissionKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key)
    .sort();
}

export interface MembershipRecord {
  id?: string;
  role: Role;
  extra_permissions: unknown;
}

export interface MembershipLoader {
  load(userId: string, tenantId: string): Promise<MembershipRecord | null>;
}

/** Résout l'acteur depuis une identité de canal DÉJÀ authentifiée. Null si non membre. */
export async function resolveActor(
  identity: { userId: string; tenantId: string; channel: Channel },
  loader: MembershipLoader,
): Promise<Actor | null> {
  const membership = await loader.load(identity.userId, identity.tenantId);
  if (!membership) return null;
  return assertActor({
    userId: identity.userId,
    tenantId: identity.tenantId,
    membershipId: membership.id,
    role: membership.role,
    extraPermissions: extraPermissionKeys(membership.extra_permissions),
    channel: identity.channel,
  });
}
