import { beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();
vi.mock("./server-client", () => ({
  getSupabaseServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }),
}));

import { assertOrganizationActive, clearOrganizationGuardCache, isOrganizationSuspended } from "./organization-guard";
import { OrganizationSuspendedError } from "@/lib/errors";

beforeEach(() => {
  maybeSingle.mockReset();
  clearOrganizationGuardCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("assertOrganizationActive (Q3 : suspension = tout bloqué)", () => {
  it("entreprise suspendue -> OrganizationSuspendedError (403)", async () => {
    maybeSingle.mockResolvedValue({ data: { status: "suspended" }, error: null });
    await expect(assertOrganizationActive("org-1")).rejects.toBeInstanceOf(OrganizationSuspendedError);
  });
  it.each(["active", "trialing", "past_due", "cancelled"])("statut %s -> autorisé", async (status) => {
    maybeSingle.mockResolvedValue({ data: { status }, error: null });
    await expect(assertOrganizationActive("org-1")).resolves.toBeUndefined();
  });
  it("identifiant vide (alerte plateforme) -> aucune lecture, autorisé", async () => {
    await expect(assertOrganizationActive("")).resolves.toBeUndefined();
    expect(maybeSingle).not.toHaveBeenCalled();
  });
  it("cache de 5 s : une seule lecture pour plusieurs envois d'affilée", async () => {
    maybeSingle.mockResolvedValue({ data: { status: "active" }, error: null });
    await isOrganizationSuspended("org-2");
    await isOrganizationSuspended("org-2");
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });
  it("lecture en échec -> ne bloque pas le service (journalisé)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(assertOrganizationActive("org-3")).resolves.toBeUndefined();
  });
});
