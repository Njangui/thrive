import { describe, expect, it } from "vitest";
import { pendingFromDb, pendingToDb, settingsFromDb } from "./supabase-agent-repositories";
import { extraPermissionKeys, resolveActor } from "@/application/agents/actor";

describe("mappings base <-> domaine", () => {
  it("pending_actions : aller-retour sans perte", () => {
    const row = {
      id: "pa-1", tenantId: "t1", toolName: "orders.refund", params: { amount: 10 },
      paramsHash: "a".repeat(64), paramsPreview: { amount: 10 }, status: "pending" as const,
      requestedBy: "u1", channel: "dashboard" as const, expiresAt: "2026-10-07T10:15:00.000Z",
    };
    const db: Record<string, unknown> = { ...pendingToDb(row), approved_by: null };
    expect(db["organization_id"]).toBe("t1");
    expect(pendingFromDb(db)).toEqual(row);
  });

  it("agent_settings : défauts sûrs sur données absentes ou invalides", () => {
    expect(settingsFromDb("t1", {})).toEqual({ tenantId: "t1", enabledTools: null, autonomy: { write_reversible: "confirm" }, budget: {}, profile: "prudent", toolPolicies: {} });
    expect(settingsFromDb("t1", { enabled_tools: ["a.b"], autonomy: { write_reversible: "allow" }, budget: { max_units_per_action: 50 } }))
      .toEqual({ tenantId: "t1", enabledTools: ["a.b"], autonomy: { write_reversible: "allow" }, budget: { maxUnitsPerAction: 50 }, profile: "prudent", toolPolicies: {} });
    expect(settingsFromDb("t1", { autonomy: { write_reversible: "n'importe quoi" }, budget: { max_units_per_action: -1 } }).autonomy.write_reversible).toBe("confirm");
  });
});

describe("extra_permissions -> acteur", () => {
  it("ne retient que les clés à true", () => {
    expect(extraPermissionKeys({ "ai.manage": true, "x.y": false, "z.w": "true" })).toEqual(["ai.manage"]);
    expect(extraPermissionKeys(null)).toEqual([]);
    expect(extraPermissionKeys([true])).toEqual([]);
  });

  it("resolveActor : non membre => null ; membre => rôle et permissions de la base", async () => {
    const loader = { load: async (u: string) => (u === "u1" ? { role: "manager" as const, extra_permissions: { "ai.manage": true } } : null) };
    expect(await resolveActor({ userId: "u2", tenantId: "t1", channel: "telegram" }, loader)).toBeNull();
    expect(await resolveActor({ userId: "u1", tenantId: "t1", channel: "telegram" }, loader)).toEqual({
      userId: "u1", tenantId: "t1", role: "manager", extraPermissions: ["ai.manage"], channel: "telegram",
    });
  });
});
