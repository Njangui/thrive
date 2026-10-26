import type { MemberRole } from "@/application/services/auth-service";
import type { AgentActor } from "@/application/channels/actor";
import { AuthorizationError } from "@/lib/errors";

/**
 * Rôles autorisés par permission d'outil Opérations. CALQUÉ sur les gardes déjà en place dans
 * le dashboard (`requireMembership(...)`) : un rôle ne peut pas, par le chat, ce qu'il ne peut pas
 * faire dans l'interface.
 *   - commandes : owner/admin/manager (écran /dashboard/orders/[id]) ; annulation et remboursement plus étroits
 *     (le remboursement n'a pas d'écran existant : même cercle que l'annulation, et au-dessus du seuil du propriétaire
 *     seuls owner/admin le peuvent — voir `refundAboveThresholdAllowed`) ;
 *   - produits & stock : owner/admin/manager (écrans /dashboard/products) ; lecture : mêmes rôles ;
 *   - rendez-vous : owner/admin/manager ; finance : owner/admin/manager (rôles réduits à 4, décision Q5).
 * Le membre simple (`employee`) n'a AUCUN outil Opérations par le chat (refus par défaut, décision Q5) ; ses écrans
 * du dashboard (conversations, commandes) restent accessibles à la main, sans agent.
 * `owner` et `admin` ont toutes les permissions. Une permission peut aussi être accordée à un membre
 * précis via `memberships.extra_permissions` (clé = nom de la permission).
 * Ceci est la seconde barrière : le moteur de règles de C1 (`evaluateAction`) reste la première.
 */
export const OPS_PERMISSIONS = {
  "orders.read": ["owner", "admin", "manager"],
  "orders.write": ["owner", "admin", "manager"],
  "orders.cancel": ["owner", "admin", "manager"],
  "orders.refund": ["owner", "admin", "manager"],
  "products.read": ["owner", "admin", "manager"],
  "products.price": ["owner", "admin", "manager"],
  "stock.write": ["owner", "admin", "manager"],
  "contacts.read": ["owner", "admin", "manager"],
  "appointments.read": ["owner", "admin", "manager"],
  "appointments.write": ["owner", "admin", "manager"],
  "finance.read": ["owner", "admin", "manager"],
  "finance.write": ["owner", "admin", "manager"],
} as const satisfies Record<string, readonly MemberRole[]>;

export type OpsPermission = keyof typeof OPS_PERMISSIONS;

export function hasPermission(actor: Pick<AgentActor, "role" | "extraPermissions">, permission: string): boolean {
  if (actor.role === "owner" || actor.role === "admin") return Object.hasOwn(OPS_PERMISSIONS, permission);
  const roles = (OPS_PERMISSIONS as Record<string, readonly MemberRole[]>)[permission];
  if (!roles) return false; // permission inconnue : refus par défaut
  return roles.includes(actor.role) || actor.extraPermissions.includes(permission);
}

export function assertPermission(actor: Pick<AgentActor, "role" | "extraPermissions">, permission: string): void {
  if (!hasPermission(actor, permission)) {
    throw new AuthorizationError(`Votre rôle (${actor.role}) ne permet pas cette action (${permission}).`);
  }
}

/** Au-dessus du seuil de remboursement fixé par le propriétaire : owner/admin (ou permission accordée à ce membre). */
export const LARGE_REFUND_PERMISSION = "orders.refund.large";
export function refundAboveThresholdAllowed(actor: Pick<AgentActor, "role" | "extraPermissions">): boolean {
  return actor.role === "owner" || actor.role === "admin" || actor.extraPermissions.includes(LARGE_REFUND_PERMISSION);
}
