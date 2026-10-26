import { describe, expect, it, vi } from "vitest";
import { createUsageService, type UsageLedgerRepository } from "./usage-service";

const base = { tenantId: "t1", actorId: "u1", kind: "ai" as const, units: 1, ref: "r1" };
const repo = (over: Partial<UsageLedgerRepository> = {}): UsageLedgerRepository => ({
  charge: vi.fn(async () => ({ status: "charged" as const })),
  reserve: vi.fn(async () => ({ status: "reserved" as const })),
  commit: vi.fn(async () => "committed" as const),
  release: vi.fn(async () => ({ status: "released" })),
  refund: vi.fn(async () => ({ status: "refunded" })),
  ...over,
});

describe("usage-service", () => {
  it.each([
    { units: 0 }, { units: -1 }, { units: NaN }, { units: Infinity }, { ref: "" }, { ref: "x".repeat(201) },
    { tenantId: "" }, { actorId: "" }, { kind: "autre" as never },
  ])("refuse une entrée invalide %o sans toucher au dépôt", async (bad) => {
    const r = repo();
    await expect(createUsageService({ repo: r }).charge({ ...base, ...bad })).rejects.toMatchObject({ code: "usage_invalid" });
    expect(r.charge).not.toHaveBeenCalled();
  });

  it("transmet le résultat du dépôt (charged / duplicate / insufficient)", async () => {
    for (const status of ["charged", "duplicate", "insufficient"] as const) {
      const s = createUsageService({ repo: repo({ charge: async () => ({ status }) }) });
      expect((await s.charge(base)).status).toBe(status);
    }
  });

  it("alerte solde bas best-effort : une alerte qui échoue ne casse pas le débit", async () => {
    const onLowBalance = vi.fn(async () => { throw new Error("boom"); });
    const s = createUsageService({ repo: repo({ charge: async () => ({ status: "charged", lowBalance: true }) }), onLowBalance });
    await expect(s.charge(base)).resolves.toMatchObject({ status: "charged" });
    expect(onLowBalance).toHaveBeenCalledWith("t1", "ai");
  });

  it("pas d'alerte quand le solde n'est pas bas", async () => {
    const onLowBalance = vi.fn();
    await createUsageService({ repo: repo(), onLowBalance }).charge(base);
    expect(onLowBalance).not.toHaveBeenCalled();
  });

  it("tronque la raison d'un remboursement à 200 caractères", async () => {
    const r = repo();
    await createUsageService({ repo: r }).refund("t1", "r1", "x".repeat(500));
    expect(r.refund).toHaveBeenCalledWith("t1", "r1", "x".repeat(200));
  });
});
