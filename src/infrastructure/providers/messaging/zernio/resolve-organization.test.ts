import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  results: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  calls: [] as Array<{ key: string; filters: Array<[string, unknown]> }>,
}));

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        limit: () => builder,
        maybeSingle: () => {
          const type = filters.find(([column]) => column === "provider_type")?.[1];
          const key = type ? `${table}:${type}` : table;
          state.calls.push({ key, filters });
          return Promise.resolve(state.results[key] ?? { data: null, error: null });
        },
      };
      return builder;
    },
  }),
}));

import { resolveOrganizationIdByWhatsAppGroupsAccount, resolveOrganizationIdByZernioAccount } from "./resolve-organization";

beforeEach(() => {
  state.results = {};
  state.calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resolveOrganizationIdByZernioAccount — numéros de MESSAGERIE (multi-numéros)", () => {
  it("un numéro secondaire (ligne de whatsapp_accounts, absent de provider_connections) est routé vers son organisation", async () => {
    state.results["whatsapp_accounts"] = { data: { organization_id: "org-2" }, error: null };

    await expect(resolveOrganizationIdByZernioAccount("acc-2")).resolves.toBe("org-2");
    expect(state.calls.map((c) => c.key)).toEqual(["whatsapp_accounts"]);
    expect(state.calls[0]?.filters).toEqual([["account_id", "acc-2"], ["status", "connected"]]);
  });

  it("repli sur provider_connections (type messaging) quand le numéro n'est pas dans whatsapp_accounts (anciennes lignes)", async () => {
    state.results["provider_connections:messaging"] = { data: { organization_id: "org-1" }, error: null };

    await expect(resolveOrganizationIdByZernioAccount("acc-legacy")).resolves.toBe("org-1");
    expect(state.calls.map((c) => c.key)).toEqual(["whatsapp_accounts", "provider_connections:messaging"]);
  });

  it("erreur de lecture de whatsapp_accounts -> on retombe sur le chemin historique, sans exception", async () => {
    state.results["whatsapp_accounts"] = { data: null, error: { message: "db down" } };
    state.results["provider_connections:messaging"] = { data: { organization_id: "org-1" }, error: null };

    await expect(resolveOrganizationIdByZernioAccount("acc-1")).resolves.toBe("org-1");
  });

  it("le résolveur de MESSAGERIE ne reconnaît PAS le numéro dédié aux groupes (compte Zernio distinct)", async () => {
    state.results["provider_connections:whatsapp_groups"] = { data: { organization_id: "org-1" }, error: null };

    await expect(resolveOrganizationIdByZernioAccount("acc-groupes")).resolves.toBeNull();
    expect(state.calls.some((c) => c.key === "provider_connections:whatsapp_groups")).toBe(false);
  });
});

describe("resolveOrganizationIdByWhatsAppGroupsAccount — numéro DÉDIÉ aux groupes", () => {
  it("résout uniquement une connexion de type whatsapp_groups, zernio, connectée, par metadata.accountId", async () => {
    state.results["provider_connections:whatsapp_groups"] = { data: { organization_id: "org-1" }, error: null };

    await expect(resolveOrganizationIdByWhatsAppGroupsAccount("acc-groupes")).resolves.toBe("org-1");
    expect(state.calls[0]?.filters).toEqual([
      ["provider_type", "whatsapp_groups"],
      ["provider_name", "zernio"],
      ["status", "connected"],
      ["metadata->>accountId", "acc-groupes"],
    ]);
  });

  it("compte inconnu ou erreur de lecture -> null", async () => {
    await expect(resolveOrganizationIdByWhatsAppGroupsAccount("inconnu")).resolves.toBeNull();

    state.results["provider_connections:whatsapp_groups"] = { data: null, error: { message: "db down" } };
    await expect(resolveOrganizationIdByWhatsAppGroupsAccount("acc-groupes")).resolves.toBeNull();
  });
});
