import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  single: { data: null as unknown, error: null as { message: string } | null },
  list: { data: [] as unknown[], error: null as { message: string } | null },
  filters: [] as Array<[string, unknown]>,
  throwOnFrom: false,
}));

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => {
      if (state.throwOnFrom) throw new Error("client indisponible");
      expect(table).toBe("whatsapp_groups");
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          state.filters.push([column, value]);
          return builder;
        },
        limit: () => builder,
        maybeSingle: () => Promise.resolve(state.single),
        then: (resolve: (value: unknown) => void) => resolve(state.list),
      };
      return builder;
    },
  }),
}));

import { isWhatsAppGroupThread, listWhatsAppGroupThreadIds } from "./whatsapp-group-threads";

beforeEach(() => {
  state.single = { data: null, error: null };
  state.list = { data: [], error: null };
  state.filters = [];
  state.throwOnFrom = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("isWhatsAppGroupThread — un fil de groupe n'est pas une conversation client", () => {
  it("vrai quand l'identifiant du fil est celui d'un groupe de CETTE organisation (filtre organisation + external_id)", async () => {
    state.single = { data: { id: "g-1" }, error: null };

    await expect(isWhatsAppGroupThread("org-1", "grp-123")).resolves.toBe(true);
    expect(state.filters).toEqual([["organization_id", "org-1"], ["external_id", "grp-123"]]);
  });

  it("faux pour une conversation 1:1 (aucun groupe ne porte cet identifiant)", async () => {
    await expect(isWhatsAppGroupThread("org-1", "conv-client-9")).resolves.toBe(false);
  });

  it("arguments vides -> faux, sans interroger la base", async () => {
    await expect(isWhatsAppGroupThread("", "grp-1")).resolves.toBe(false);
    await expect(isWhatsAppGroupThread("org-1", "")).resolves.toBe(false);
    expect(state.filters).toHaveLength(0);
  });

  it("erreur de lecture ou exception -> faux (le traitement normal continue), jamais d'exception propagée", async () => {
    state.single = { data: null, error: { message: "db down" } };
    await expect(isWhatsAppGroupThread("org-1", "grp-1")).resolves.toBe(false);

    state.throwOnFrom = true;
    await expect(isWhatsAppGroupThread("org-1", "grp-1")).resolves.toBe(false);
  });
});

describe("listWhatsAppGroupThreadIds", () => {
  it("renvoie l'ensemble des identifiants de groupes de l'organisation", async () => {
    state.list = { data: [{ external_id: "grp-1" }, { external_id: "grp-2" }], error: null };

    const ids = await listWhatsAppGroupThreadIds("org-1");

    expect([...ids].sort()).toEqual(["grp-1", "grp-2"]);
    expect(state.filters).toEqual([["organization_id", "org-1"]]);
  });

  it("ensemble vide sur erreur ou organisation vide", async () => {
    state.list = { data: [], error: { message: "db down" } };
    expect((await listWhatsAppGroupThreadIds("org-1")).size).toBe(0);
    expect((await listWhatsAppGroupThreadIds("")).size).toBe(0);
  });
});
