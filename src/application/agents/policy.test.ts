import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolDef } from "./contracts";
import { decide, MAX_AUTO_BULK_MESSAGES } from "./rule-engine";
import { createAgentKernel } from "./tool-registry";
import { defaultAgentSettings, effectiveWritePolicy, PROFILE_DEFAULTS, type AgentSettings } from "./settings";
import { actor, TENANT_A } from "./testing/harness";
import { sanitizeToolPolicies } from "@/infrastructure/agents/supabase-agent-repositories";

const mk = (over: Partial<ToolDef<unknown, unknown>>): ToolDef<unknown, unknown> => ({
  name: "demo.write", domain: "demo", description: "d", input: z.object({}), output: z.object({}),
  risk: "write_reversible", permission: "demo.write", run: async () => ({}), ...over,
});
const kernel = createAgentKernel();
for (const p of ["demo.write", "demo.read", "demo.danger", "demo.bulk"]) kernel.matrix.define(p, ["owner", "admin", "manager"]);
const run = (tool: ToolDef<unknown, unknown>, settings: AgentSettings, amount?: number | null, role: "owner" | "manager" | "employee" = "owner") =>
  decide({ actor: actor(role), tool, input: {}, settings, matrix: kernel.matrix, amount });
const withSettings = (o: Partial<AgentSettings>): AgentSettings => ({ ...defaultAgentSettings(TENANT_A), ...o });

describe("profils", () => {
  it("prudent : toute écriture demande validation ; lecture libre", () => {
    const s = withSettings({ profile: "prudent" });
    expect(run(mk({}), s)).toEqual({ decision: "confirm", reason: "autonomy_confirm" });
    expect(run(mk({ name: "demo.read", risk: "read", permission: "demo.read" }), s).decision).toBe("allow");
  });
  it("équilibré : auto sous le seuil, validation au-dessus, et si le montant est inconnu", () => {
    const s = withSettings({ profile: "balanced" });
    const t = PROFILE_DEFAULTS.balanced.autoMaxAmount!;
    expect(run(mk({}), s, t)).toEqual({ decision: "allow", reason: "autonomy_allow" });
    expect(run(mk({}), s, t + 1)).toEqual({ decision: "confirm", reason: "amount_over_threshold" });
    expect(run(mk({}), s, null)).toEqual({ decision: "confirm", reason: "amount_unknown" });
    expect(run(mk({}), s)).toEqual({ decision: "allow", reason: "autonomy_allow" }); // outil sans dimension monétaire
  });
  it("autonome : seuil plus haut", () => {
    const s = withSettings({ profile: "autonomous" });
    expect(run(mk({}), s, 400_000).decision).toBe("allow");
    expect(run(mk({}), s, 500_001).decision).toBe("confirm");
  });
});

describe("exceptions par outil", () => {
  it("l'exception de l'outil l'emporte sur le profil, dans les deux sens", () => {
    expect(run(mk({}), withSettings({ profile: "prudent", toolPolicies: { "demo.write": { mode: "auto" } } })).decision).toBe("allow");
    expect(run(mk({}), withSettings({ profile: "autonomous", toolPolicies: { "demo.write": { mode: "confirm" } } })).decision).toBe("confirm");
  });
  it("seuil propre à l'outil", () => {
    const s = withSettings({ toolPolicies: { "demo.write": { mode: "auto", autoMaxAmount: 1000 } } });
    expect(run(mk({}), s, 1000).decision).toBe("allow");
    expect(run(mk({}), s, 1001).decision).toBe("confirm");
  });
  it("deny : l'outil est indisponible, même pour le propriétaire", () => {
    const s = withSettings({ toolPolicies: { "demo.write": { mode: "deny" } } });
    expect(run(mk({}), s)).toEqual({ decision: "deny", reason: "tool_disabled" });
    expect(run(mk({ name: "demo.read", risk: "read", permission: "demo.read" }), withSettings({ toolPolicies: { "demo.read": { mode: "deny" } } })).decision).toBe("deny");
  });
  it("profil custom : compatibilité avec l'ancien réglage « allow »", () => {
    expect(effectiveWritePolicy(withSettings({ profile: "custom", autonomy: { write_reversible: "allow" } }), "x.y")).toEqual({ mode: "auto" });
    expect(effectiveWritePolicy(withSettings({ profile: "custom" }), "x.y")).toEqual({ mode: "confirm" });
  });
});

describe("garde-fous fixes : aucun réglage ne les lève", () => {
  const everythingAuto = withSettings({ profile: "autonomous", toolPolicies: { "demo.danger": { mode: "auto" }, "demo.bulk": { mode: "auto" }, "demo.write": { mode: "auto" } } });
  it("action sensible : toujours validée, même en mode auto", () => {
    expect(run(mk({ name: "demo.danger", risk: "sensitive", permission: "demo.danger" }), everythingAuto)).toEqual({ decision: "confirm", reason: "sensitive_always_confirmed" });
  });
  it("message client (confirmAlways) : toujours validé, même avec une exception « auto » sans seuil", () => {
    const s = withSettings({ profile: "autonomous", toolPolicies: { "demo.write": { mode: "auto" } } });
    expect(run(mk({ name: "demo.write", risk: "write_reversible", permission: "demo.write", confirmAlways: true }), s)).toEqual({ decision: "confirm", reason: "always_confirmed" });
  });
  it("action sensible : « interdit » reste possible (le propriétaire peut couper)", () => {
    const s = withSettings({ toolPolicies: { "demo.danger": { mode: "deny" } } });
    expect(run(mk({ name: "demo.danger", risk: "sensitive", permission: "demo.danger" }), s).decision).toBe("deny");
  });
  it("envoi groupé au-delà du seuil : validé, même en mode auto", () => {
    const bulk = (n: number) => mk({ name: "demo.bulk", permission: "demo.bulk", estimateCost: () => ({ items: [{ kind: "message", units: n }] }) });
    const s = withSettings({ ...everythingAuto, budget: { maxUnitsPerAction: 10_000 } });
    expect(run(bulk(MAX_AUTO_BULK_MESSAGES), s).decision).toBe("allow");
    expect(run(bulk(MAX_AUTO_BULK_MESSAGES + 1), s)).toEqual({ decision: "confirm", reason: "bulk_send_requires_approval" });
  });
  it("plafond de coût par action : validé", () => {
    const costly = mk({ estimateCost: () => ({ items: [{ kind: "ai", units: 11 }] }) });
    expect(run(costly, everythingAuto)).toEqual({ decision: "confirm", reason: "budget_cap_exceeded" });
  });
  it("les droits du rôle passent avant la politique : un membre sans permission est refusé même en mode auto", () => {
    expect(run(mk({}), everythingAuto, undefined, "employee")).toEqual({ decision: "deny", reason: "permission_denied" });
  });
  it("zone vitrine : jamais d'écriture, quelle que soit la politique", () => {
    const customer = actor("owner", { channel: "customer" });
    expect(decide({ actor: customer, tool: mk({}), input: {}, settings: everythingAuto, matrix: kernel.matrix })).toEqual({ decision: "deny", reason: "storefront_forbidden" });
  });
});

describe("lecture défensive des politiques stockées", () => {
  it("entrée illisible => confirm (jamais plus permissif) ; deny conservé ; montants négatifs ignorés", () => {
    expect(sanitizeToolPolicies({ "a.b": { mode: "bogus" }, "c.d": "x", "e.f": { mode: "deny" }, "g.h": { mode: "auto", autoMaxAmount: -5 }, "i.j": { mode: "auto", autoMaxAmount: 200 } })).toEqual({
      "a.b": { mode: "confirm" }, "c.d": { mode: "confirm" }, "e.f": { mode: "deny" }, "g.h": { mode: "auto" }, "i.j": { mode: "auto", autoMaxAmount: 200 },
    });
    expect(sanitizeToolPolicies(null)).toEqual({});
    expect(sanitizeToolPolicies([1, 2])).toEqual({});
  });
});

import { buildHarness } from "./testing/harness";

describe("evaluateAction : montant calculé par le code", () => {
  const setup = (amountOf: ToolDef<unknown, unknown>["amountOf"]) => {
    const h = buildHarness({ stepUp: { requestStepUp: async () => ({ verified: true }) } });
    const tool = mk({ name: "demo.pay", permission: "demo.pay", amountOf });
    h.kernel.registerTool(tool as never, { roles: ["owner"] });
    h.settings.withDefaults(TENANT_A, { profile: "balanced" });
    return { h, tool };
  };
  it("sous le seuil : exécuté seul ; au-dessus : carte d'approbation", async () => {
    let amount = 40_000;
    const { h, tool } = setup(async () => amount);
    expect((await h.deps.evaluate(actor("owner"), tool, {})).decision).toBe("allow");
    amount = 80_000;
    const r = await h.deps.evaluate(actor("owner"), tool, {});
    expect(r).toMatchObject({ decision: "confirm", reason: "amount_over_threshold" });
  });
  it("montant impossible à calculer (erreur ou valeur absurde) : validation, jamais exécution seule", async () => {
    const boom = setup(async () => { throw new Error("catalogue indisponible"); });
    expect(await boom.h.deps.evaluate(actor("owner"), boom.tool, {})).toMatchObject({ decision: "confirm", reason: "amount_unknown" });
    const nan = setup(async () => Number.NaN);
    expect(await nan.h.deps.evaluate(actor("owner"), nan.tool, {})).toMatchObject({ decision: "confirm", reason: "amount_unknown" });
    const none = setup(async () => undefined);
    expect(await none.h.deps.evaluate(actor("owner"), none.tool, {})).toMatchObject({ decision: "confirm", reason: "amount_unknown" });
  });
});
