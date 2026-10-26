import { describe, expect, it } from "vitest";
import { ALL_ROLES, createPermissionMatrix, renderRoleToolMatrix } from "./role-matrix";
import type { Role } from "./contracts";

describe("matrice rôle × permission", () => {
  it("accorde exactement les rôles déclarés, pour chacun des 7 rôles", () => {
    const matrix = createPermissionMatrix();
    const granted: Role[] = ["owner", "manager", "employee"];
    matrix.define("finance.read", granted);
    for (const role of ALL_ROLES) {
      expect(matrix.has({ role, extraPermissions: [] }, "finance.read")).toBe(granted.includes(role));
    }
  });

  it("extra_permissions accorde en plus ; une permission non déclarée est refusée même à l'owner", () => {
    const matrix = createPermissionMatrix();
    matrix.define("ai.manage", ["owner"]);
    expect(matrix.has({ role: "employee", extraPermissions: ["ai.manage"] }, "ai.manage")).toBe(true);
    expect(matrix.has({ role: "owner", extraPermissions: [] }, "inconnue.permission")).toBe(false);
    expect(matrix.has({ role: "employee", extraPermissions: ["inconnue.permission"] }, "inconnue.permission")).toBe(false);
  });

  it("rejette les déclarations invalides ou contradictoires", () => {
    const matrix = createPermissionMatrix();
    expect(() => matrix.define("mauvais", ["owner"])).toThrow();
    expect(() => matrix.define("a.b", [])).toThrow();
    matrix.define("a.b", ["owner"]);
    expect(() => matrix.define("a.b", ["admin"])).toThrow();
    expect(() => matrix.define("a.b", ["owner"])).not.toThrow();
  });

  it("rend un tableau Markdown", () => {
    const matrix = createPermissionMatrix();
    matrix.define("a.b", ["owner", "admin"]);
    const md = renderRoleToolMatrix([{ name: "a.b", domain: "a", risk: "read", permission: "a.b" }], matrix);
    expect(md.split("\n")).toHaveLength(3);
    expect(md).toContain("| a.b | a | read | a.b |");
  });
});
