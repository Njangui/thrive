import type { MemberRole } from "@/application/services/auth-service";

/**
 * Acteur d'un message entrant sur un canal back-office (C2).
 *
 * ALIGNEMENT C1 : la forme suit l'esquisse du contrat (`Actor` de
 * `src/application/agents/contracts.ts`, livré par C1). Tant que cette PR
 * « contrats » n'est pas fusionnée, ce type local en est le miroir ; il sera
 * remplacé par un simple `export type { Actor } from "../agents/contracts"`.
 * Seuls les canaux back-office authentifiés (`telegram`, `whatsapp`) sont
 * produits ici — `dashboard` vient de la session, `scheduler`/`customer` ne
 * passent jamais par `resolveActor`.
 */
export type BackofficeChannel = "telegram" | "whatsapp";

export type ActorChannel = BackofficeChannel | "dashboard";

export interface BackofficeActor {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: MemberRole;
  extraPermissions: string[];
  channel: BackofficeChannel;
}

/**
 * Acteur tous canaux interactifs : comme `BackofficeActor`, mais `channel` inclut
 * `dashboard` (session web). Forme transmise au runtime.
 */
export type AgentActor = Omit<BackofficeActor, "channel"> & { channel: ActorChannel };

/**
 * `memberships.extra_permissions` est un jsonb OBJET (`{"manage_ai": true}`,
 * voir 0001_core_tenancy.sql) alors que le contrat C1 type `string[]`.
 * Adaptateur sans migration destructive : on garde les clés dont la valeur est
 * strictement `true`. Toute autre forme (null, tableau legacy de chaînes,
 * valeurs « truthy » non booléennes) est traitée de façon défensive : un tableau
 * de chaînes est accepté tel quel, le reste est ignoré — jamais d'élévation de
 * droits par une valeur ambiguë.
 */
export function normalizeExtraPermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0))).sort();
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value === true)
      .map(([key]) => key)
      .sort();
  }
  return [];
}
