/**
 * Accès base scopé tenant pour les outils : le filtre tenant est appliqué
 * PAR CONSTRUCTION (indépendamment de la discipline de chaque outil), car
 * l'isolation repose ici sur service-role, pas sur la RLS (principe 5).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantScopedDb, TenantScopedTable } from "./contracts";
import { AgentError } from "./errors";

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
/** Tables dont la colonne de tenant n'est pas `organization_id`. */
const TENANT_COLUMN_OVERRIDES: Record<string, string> = { organizations: "id" };
/** Jamais modifiable depuis un outil. */
const FORBIDDEN_TABLES = new Set(["memberships", "platform_admins", "agent_audit_events", "pending_actions"]);

export function createTenantScopedDb(client: SupabaseClient, tenantId: string): TenantScopedDb {
  if (!tenantId) throw new AgentError("actor_required", "createTenantScopedDb sans tenant");

  const guardRow = (row: unknown, column: string): Record<string, unknown> => {
    const record = (row ?? {}) as Record<string, unknown>;
    if (record[column] !== undefined && record[column] !== tenantId) {
      throw new AgentError("tenant_isolation", "Écriture refusée : le tenant de la ligne diffère de celui de l'acteur");
    }
    return record;
  };

  const stamp = (values: Record<string, unknown> | Record<string, unknown>[], column: string) =>
    Array.isArray(values)
      ? values.map((row) => ({ ...guardRow(row, column), [column]: tenantId }))
      : { ...guardRow(values, column), [column]: tenantId };

  return {
    tenantId,
    __brand: "TenantScopedDb",
    from(table: string): TenantScopedTable {
      if (!TABLE_NAME.test(table)) throw new AgentError("tenant_isolation", `Nom de table invalide : ${table}`);
      const column = TENANT_COLUMN_OVERRIDES[table] ?? "organization_id";
      const base = () => client.from(table);
      const writable = !FORBIDDEN_TABLES.has(table) && table !== "organizations";
      const denyWrite = (): never => {
        throw new AgentError("tenant_isolation", `Écriture interdite sur ${table}`);
      };
      return {
        select: (...args) => base().select(...args).eq(column, tenantId),
        insert: (values, options) => {
          if (!writable) denyWrite();
          return base().insert(stamp(values, column), options);
        },
        upsert: (values, options) => {
          if (!writable) denyWrite();
          return base().upsert(stamp(values, column), options);
        },
        update: (values, options) => {
          if (!writable) denyWrite();
          guardRow(values, column);
          return base().update(values, options).eq(column, tenantId);
        },
        delete: () => {
          if (!writable) denyWrite();
          return base().delete().eq(column, tenantId);
        },
      };
    },
  };
}
