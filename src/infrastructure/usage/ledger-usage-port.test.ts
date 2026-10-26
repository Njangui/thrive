import { describe, expect, it } from "vitest";
import type { UsageService } from "@/application/agents/contracts";
import { createLedgerUsagePort } from "./ledger-usage-port";

const input = { tenantId: "t1", actorId: "u1", kind: "media" as const, units: 40, ref: "job-1" };
const port = (status: "charged" | "duplicate" | "insufficient") => createLedgerUsagePort({ charge: async () => ({ status }) } satisfies UsageService);

describe("createLedgerUsagePort", () => {
  it("charged / duplicate sont traduits pour le Studio", async () => {
    expect(await port("charged").charge(input)).toEqual({ charged: true, alreadyCharged: false });
    expect(await port("duplicate").charge(input)).toEqual({ charged: false, alreadyCharged: true });
  });
  it("solde insuffisant : lève (le Studio ne lance alors aucune génération)", async () => {
    await expect(port("insufficient").charge(input)).rejects.toThrow("Solde insuffisant");
  });
  it("transmet l'entrée telle quelle au registre", async () => {
    let seen: unknown;
    await createLedgerUsagePort({ charge: async (i) => { seen = i; return { status: "charged" }; } }).charge(input);
    expect(seen).toEqual(input);
  });
});
