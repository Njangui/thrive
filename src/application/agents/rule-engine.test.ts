import { describe, expect, it } from "vitest";
import { ALL_ROLES } from "./role-matrix";
import { decide } from "./rule-engine";
import { defaultAgentSettings, type AgentSettings } from "./settings";
import { actor, addNote, buildHarness, draftDescription, listProducts, TENANT_A, updatePrice } from "./testing/harness";
import type { ToolDef } from "./contracts";

const kernelMatrix = buildHarness().kernel.matrix;
const settingsAll = (over: Partial<AgentSettings> = {}): AgentSettings => ({ ...defaultAgentSettings(TENANT_A), enabledTools: [listProducts.name, draftDescription.name, addNote.name, updatePrice.name], ...over });
const tool = (t: unknown) => t as ToolDef<unknown, unknown>;
const run = (a: ReturnType<typeof actor>, t: unknown, settings = settingsAll()) =>
  decide({ actor: a, tool: tool(t), input: { productId: "p1", price: 1 }, settings, matrix: kernelMatrix });

describe("moteur de règles — décision pure", () => {
  it("matrice rôle × outil : seuls owner/admin atteignent un outil sensible (7 rôles)", () => {
    for (const role of ALL_ROLES) {
      const verdict = run(actor(role), updatePrice);
      expect(verdict.decision).toBe(role === "owner" || role === "admin" ? "confirm" : "deny");
      if (verdict.decision === "deny") expect(verdict.reason).toBe("permission_denied");
    }
  });

  it("extra_permissions ouvre l'accès (mais sensitive reste confirmé)", () => {
    const verdict = run(actor("employee", { extraPermissions: ["catalog.price"] }), updatePrice);
    expect(verdict).toEqual({ decision: "confirm", reason: "sensitive_always_confirmed" });
  });

  it("sensitive est confirmé même si le propriétaire met tout en autonomie", () => {
    const settings = settingsAll({ profile: "custom", autonomy: { write_reversible: "allow" } });
    expect(run(actor("owner"), updatePrice, settings).decision).toBe("confirm");
  });

  it("write_reversible : confirm par défaut, allow si le propriétaire l'a décidé", () => {
    expect(run(actor("manager"), addNote).decision).toBe("confirm");
    expect(run(actor("manager"), addNote, settingsAll({ profile: "custom", autonomy: { write_reversible: "allow" } })).decision).toBe("allow");
  });

  it("read est libre pour tous les rôles", () => {
    for (const role of ALL_ROLES) expect(run(actor(role), listProducts).decision).toBe("allow");
  });

  it("défaut sûr : sans réglages, lecture libre et toute écriture demande validation", () => {
    const defaults = defaultAgentSettings(TENANT_A);
    expect(run(actor("owner"), listProducts, defaults).decision).toBe("allow");
    // Nouveau défaut : tout outil est disponible, la VALIDATION protège (écriture => confirm, jamais auto sans réglage).
    expect(run(actor("owner"), addNote, defaults)).toEqual({ decision: "confirm", reason: "autonomy_confirm" });
  });

  it("un outil désactivé par le propriétaire est refusé, même à l'owner", () => {
    const settings = settingsAll({ enabledTools: [listProducts.name] });
    expect(run(actor("owner"), updatePrice, settings)).toEqual({ decision: "deny", reason: "tool_disabled" });
  });

  it("zone vitrine : seulement les outils storefrontSafe, jamais d'écriture interne", () => {
    const customer = actor("employee", { channel: "customer" });
    expect(run(customer, listProducts).decision).toBe("allow");
    expect(run(customer, draftDescription).decision).toBe("allow");
    expect(run(customer, addNote)).toEqual({ decision: "deny", reason: "storefront_forbidden" });
    expect(run(customer, updatePrice)).toEqual({ decision: "deny", reason: "storefront_forbidden" });
  });

  it("plafond de budget dépassé => confirmation", () => {
    const sensitiveLike = { ...updatePrice, risk: "read", permission: "catalog.read", estimateCost: () => ({ items: [{ kind: "media", units: 100 }] }) };
    const settings = settingsAll({ budget: { maxUnitsPerAction: 50 } });
    expect(run(actor("owner"), sensitiveLike, settings)).toEqual({ decision: "confirm", reason: "budget_cap_exceeded" });
  });
});

describe("evaluateAction — E/S", () => {
  it("refuse sans acteur valide, avec entrée invalide ; crée la carte pour confirm", async () => {
    const h = buildHarness();
    h.settings.withDefaults(TENANT_A, { enabledTools: [updatePrice.name] });
    const evaluate = h.deps.evaluate;
    expect(await evaluate(undefined as never, tool(updatePrice), {})).toEqual({ decision: "deny", reason: "actor_required" });
    expect(await evaluate({ ...actor("owner"), tenantId: "" }, tool(updatePrice), { productId: "p1", price: 1 })).toEqual({ decision: "deny", reason: "actor_required" });
    expect(await evaluate(actor("owner"), tool(updatePrice), { productId: "p1", price: -5 })).toEqual({ decision: "deny", reason: "invalid_input" });
    const ok = await evaluate(actor("owner"), tool(updatePrice), { productId: "p1", price: 12 });
    expect(ok.decision).toBe("confirm");
    expect(h.repo.rows.size).toBe(1);
  });
});

describe("A1 : plafond par défaut par action", () => {
  it("une action au coût estimé > défaut exige une confirmation même en autonomie allow", async () => {
    const { DEFAULT_MAX_UNITS_PER_ACTION, defaultAgentSettings } = await import("./settings");
    const { decide } = await import("./rule-engine");
    const { createAgentKernel } = await import("./tool-registry");
    const { actor } = await import("./testing/harness");
    const tool = {
      name: "x.costly", domain: "x", description: "d", input: (await import("zod")).z.object({}), output: (await import("zod")).z.object({}),
      risk: "write_reversible", permission: "x.write", storefrontSafe: false,
      estimateCost: () => ({ items: [{ kind: "ai", units: DEFAULT_MAX_UNITS_PER_ACTION + 1 }] }),
      handler: async () => ({}),
    } as never;
    const kernel = createAgentKernel();
    kernel.registerTool(tool, { roles: ["owner"] });
    const settings = { ...defaultAgentSettings("t"), enabledTools: ["x.costly"], profile: "custom" as const, autonomy: { write_reversible: "allow" as const } };
    expect(decide({ actor: actor("owner"), tool, input: {}, settings, matrix: kernel.matrix })).toEqual({ decision: "confirm", reason: "budget_cap_exceeded" });
  });
});
