/**
 * Matrice permission × rôle (en code, pas en prompt — principe 4).
 * Un outil déclare UNE permission `domaine.action` ; la matrice dit quels
 * rôles la détiennent. `extra_permissions` du membre (clés à true) peut
 * l'accorder en plus. Permission non déclarée => refus (fail-closed).
 */
import type { Actor, Role, ToolDef } from "./contracts";
import { AgentError } from "./errors";

export const ALL_ROLES: readonly Role[] = ["owner", "admin", "manager", "employee"];
export const MANAGEMENT_ROLES: readonly Role[] = ["owner", "admin"];

const PERMISSION_FORMAT = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export interface PermissionMatrix {
  define(permission: string, roles: readonly Role[]): void;
  rolesFor(permission: string): ReadonlySet<Role> | undefined;
  /** Rôle OU permission supplémentaire. Faux si la permission n'est pas déclarée. */
  has(actor: Pick<Actor, "role" | "extraPermissions">, permission: string): boolean;
  entries(): Array<[string, ReadonlySet<Role>]>;
}

export function createPermissionMatrix(): PermissionMatrix {
  const table = new Map<string, ReadonlySet<Role>>();
  return {
    define(permission, roles) {
      if (!PERMISSION_FORMAT.test(permission)) {
        throw new AgentError("registry_invalid", `Permission mal formée : ${permission}`);
      }
      if (roles.length === 0) {
        throw new AgentError("registry_invalid", `Permission sans rôle : ${permission}`);
      }
      const next = new Set(roles);
      const existing = table.get(permission);
      if (existing && (existing.size !== next.size || [...next].some((r) => !existing.has(r)))) {
        throw new AgentError("registry_invalid", `Permission déjà déclarée avec d'autres rôles : ${permission}`);
      }
      table.set(permission, next);
    },
    rolesFor: (permission) => table.get(permission),
    has(actor, permission) {
      const roles = table.get(permission);
      if (!roles) return false;
      return roles.has(actor.role) || actor.extraPermissions.includes(permission);
    },
    entries: () => [...table.entries()],
  };
}

/** Rendu Markdown de `docs/agents/ROLE_TOOL_MATRIX.md` (section générée). */
export function renderRoleToolMatrix(
  tools: Array<Pick<ToolDef<unknown, unknown>, "name" | "domain" | "risk" | "permission" | "storefrontSafe">>,
  matrix: PermissionMatrix,
): string {
  const header = `| Outil | Domaine | Risque | Permission | Vitrine | ${ALL_ROLES.join(" | ")} |`;
  const separator = `|${"---|".repeat(5 + ALL_ROLES.length)}`;
  const rows = [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => {
      const roles = matrix.rolesFor(tool.permission);
      const cells = ALL_ROLES.map((role) => (roles?.has(role) ? "✓" : "")).join(" | ");
      return `| ${tool.name} | ${tool.domain} | ${tool.risk} | ${tool.permission} | ${tool.storefrontSafe ? "oui" : ""} | ${cells} |`;
    });
  return [header, separator, ...rows].join("\n");
}
