import { describe, expect, it } from "vitest";
import { getAgentKernel, resetAgentKernelForTests } from "../kernel";
import { isToolExposed } from "../runtime";
import { defaultAgentSettings } from "../settings";
import { validateAgentGraph } from "../agent-registry";
import { toOpsActor } from "./operations";
import type { Actor } from "../contracts";

const base: Actor = { userId: "u", tenantId: "t", membershipId: "m", role: "owner", extraPermissions: [], channel: "dashboard" };

describe("domaine Opérations", () => {
  it("le graphe d'agents est valide et l'assistant voit tous les outils enregistrés", () => {
    resetAgentKernelForTests();
    const { kernel, agents } = getAgentKernel();
    expect(validateAgentGraph(agents, kernel.registry)).toEqual([]);
    expect(agents.get("assistant")!.tools.length).toBe(kernel.registry.list().length);
  });

  it("un employé ne voit aucun outil de gestion ; propriétaire et gérant en voient", () => {
    const { kernel } = getAgentKernel();
    const settings = { ...defaultAgentSettings("t"), enabledTools: null };
    const visible = (role: Actor["role"]) => kernel.registry.list().filter((tool) => isToolExposed({ actor: { ...base, role }, tool, settings, matrix: kernel.matrix })).length;
    expect(visible("employee")).toBe(0);
    expect(visible("owner")).toBeGreaterThan(10);
    expect(visible("manager")).toBeGreaterThan(10);
  });

  it("un client ou une vitrine ne peut pas utiliser les outils de gestion", () => {
    const { kernel } = getAgentKernel();
    const settings = { ...defaultAgentSettings("t"), enabledTools: null };
    const tool = kernel.registry.get("orders.refund")!;
    expect(isToolExposed({ actor: { ...base, channel: "customer" }, tool, settings, matrix: kernel.matrix })).toBe(false);
    expect(() => toOpsActor({ ...base, channel: "customer" })).toThrow();
    expect(() => toOpsActor({ ...base, membershipId: undefined })).toThrow();
    expect(toOpsActor({ ...base, channel: "scheduler" }).channel).toBe("dashboard");
  });

  it("les actions sensibles du métier restent sensibles dans le noyau", () => {
    const { kernel } = getAgentKernel();
    for (const n of ["orders.refund", "orders.cancel", "products.setPrice"]) expect(kernel.registry.get(n)!.risk).toBe("sensitive");
  });
});
