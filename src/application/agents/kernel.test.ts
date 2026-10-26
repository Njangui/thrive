import { afterEach, describe, expect, it } from "vitest";
import { getAgentKernel, resetAgentKernelForTests } from "./kernel";

afterEach(() => resetAgentKernelForTests());

describe("noyau partagé", () => {
  it("singleton valide, avec les outils Opérations et l'agent assistant", () => {
    const a = getAgentKernel();
    expect(getAgentKernel()).toBe(a);
    const names = a.kernel.registry.list().map((t) => t.name);
    expect(names).toContain("orders.create");
    expect(names).toContain("products.setPrice");
    expect(a.agents.get("assistant")?.tools).toEqual(names);
  });
});
