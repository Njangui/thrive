import { describe, expect, it, vi } from "vitest";
import type { MemoryService } from "@/application/memory/memory-service";
import { createAgentKernel } from "../tool-registry";
import { createMemoryRegistrar } from "./memory";
import { createAgentRegistry } from "../agent-registry";

describe("outils memory.*", () => {
  const service = { search: vi.fn(), remember: vi.fn(), forget: vi.fn(), erase: vi.fn() } as unknown as MemoryService;
  const kernel = createAgentKernel();
  createMemoryRegistrar(service)({ kernel, agents: createAgentRegistry() });

  it("enregistre les trois outils avec les bons risques et permissions", () => {
    const tools = Object.fromEntries(kernel.registry.list().map((t) => [t.name, t]));
    expect(tools["memory.search"]).toMatchObject({ risk: "read", permission: "memory.read" });
    expect(tools["memory.remember"]).toMatchObject({ risk: "write_reversible", permission: "memory.write" });
    expect(tools["memory.forget"]).toMatchObject({ risk: "write_reversible", permission: "memory.forget" });
  });

  it("aucun outil mémoire n'est accessible depuis la vitrine ni aux rôles opérationnels", () => {
    for (const t of kernel.registry.list()) expect(t.storefrontSafe).toBeFalsy();
    for (const role of ["employee", "employee", "employee", "employee"] as const) {
      expect(kernel.matrix.has({ role, extraPermissions: [] }, "memory.write")).toBe(false);
      expect(kernel.matrix.has({ role, extraPermissions: [] }, "memory.read")).toBe(false);
    }
    expect(kernel.matrix.has({ role: "manager", extraPermissions: [] }, "memory.read")).toBe(true);
  });

  it("memory.search délègue au service avec l'acteur et formate les résultats", async () => {
    (service.search as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "ok", hits: [{ id: "i1", kind: "faq", content: "Horaires", source: "user", similarity: 0.87654 }] });
    const tool = kernel.registry.list().find((t) => t.name === "memory.search")!;
    const actor = { userId: "u", tenantId: "t", role: "owner" as const, extraPermissions: [], channel: "dashboard" as const };
    const out = await tool.run({ actor, runId: "r", db: {} as never, usage: {} as never }, { query: "horaires" });
    expect(out).toEqual({ status: "ok", results: [{ id: "i1", kind: "faq", content: "Horaires", similarity: 0.877 }] });
    expect(service.search).toHaveBeenCalledWith(actor, { query: "horaires" });
  });
});
