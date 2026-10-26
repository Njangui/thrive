import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolDef } from "./contracts";
import { createAgentKernel, createToolRegistry } from "./tool-registry";

const base: ToolDef<unknown, unknown> = {
  name: "demo.read",
  domain: "demo",
  description: "Outil de démonstration.",
  input: z.object({}),
  risk: "read",
  permission: "demo.read",
  run: async () => ({}),
};

describe("registre d'outils", () => {
  it("enregistre et retrouve par nom et par domaine", () => {
    const registry = createToolRegistry();
    registry.register(base);
    expect(registry.get("demo.read")).toBeDefined();
    expect(registry.listForDomain("demo")).toHaveLength(1);
    expect(registry.listForDomain("autre")).toHaveLength(0);
  });

  it.each([
    ["doublon", () => { const r = createToolRegistry(); r.register(base); r.register(base); }],
    ["nom sans domaine", () => createToolRegistry().register({ ...base, name: "lire" })],
    ["préfixe ≠ domaine", () => createToolRegistry().register({ ...base, name: "autre.read" })],
    ["description vide", () => createToolRegistry().register({ ...base, description: " " })],
    ["outil sensible exposé à la vitrine", () => createToolRegistry().register({ ...base, risk: "sensitive", storefrontSafe: true })],
  ])("refuse : %s", (_label, action) => {
    expect(action).toThrow();
  });

  it("le noyau déclare permission + outil en un appel", () => {
    const kernel = createAgentKernel();
    kernel.registerTool(base, { roles: ["owner"] });
    expect(kernel.matrix.has({ role: "owner", extraPermissions: [] }, "demo.read")).toBe(true);
    expect(kernel.matrix.has({ role: "admin", extraPermissions: [] }, "demo.read")).toBe(false);
  });
});
