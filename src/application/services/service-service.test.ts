import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./catalog-service", () => ({
  findOrCreateCategory: vi.fn(async (_orgId: string, name: string) => `cat-${name}`),
}));

const tableResults = new Map<string, { data: unknown; error: unknown }>();
const insertCalls: { table: string; rows: unknown }[] = [];
const updateCalls: { table: string; patch: unknown }[] = [];

function makeBuilder(table: string) {
  const resultFor = () => tableResults.get(table) ?? { data: null, error: null };
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    insert: vi.fn((rows: unknown) => {
      insertCalls.push({ table, rows });
      return builder;
    }),
    update: vi.fn((patch: unknown) => {
      updateCalls.push({ table, patch });
      return builder;
    }),
    maybeSingle: vi.fn(async () => resultFor()),
    single: vi.fn(async () => resultFor()),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultFor()).then(resolve, reject),
  };
  return builder;
}

const mockFrom = vi.fn((table: string) => makeBuilder(table));

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import {
  listServicesForOrg,
  getServiceForEdit,
  createService,
  updateService,
  toggleServiceStatus,
} from "./service-service";

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.clear();
  insertCalls.length = 0;
  updateCalls.length = 0;
});

describe("listServicesForOrg", () => {
  it("mappe la catégorie imbriquée et convertit price en nombre", async () => {
    tableResults.set("services", {
      data: [{ id: "s1", name: "Coupe", price: "5000", duration_minutes: 30, status: "active", categories: { name: "Coiffure" } }],
      error: null,
    });

    const services = await listServicesForOrg("org-1");
    expect(services).toEqual([
      { id: "s1", name: "Coupe", price: 5000, durationMinutes: 30, status: "active", categoryName: "Coiffure", description: null },
    ]);
  });
});

describe("getServiceForEdit", () => {
  it("lève NotFoundError si le service n'existe pas pour cette org", async () => {
    tableResults.set("services", { data: null, error: null });
    await expect(getServiceForEdit("org-1", "s-x")).rejects.toThrow(/introuvable/i);
  });
});

describe("createService — validation avant tout accès DB", () => {
  it("refuse un nom vide", async () => {
    await expect(createService({ organizationId: "org-1", name: "  ", price: 1000 })).rejects.toThrow(/nom/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuse un prix négatif", async () => {
    await expect(createService({ organizationId: "org-1", name: "Coupe", price: -10 })).rejects.toThrow(/prix/i);
  });

  it("refuse une durée négative ou nulle", async () => {
    await expect(
      createService({ organizationId: "org-1", name: "Coupe", price: 1000, durationMinutes: 0 }),
    ).rejects.toThrow(/durée/i);
  });

  it("crée le service avec un statut actif par défaut", async () => {
    tableResults.set("services", { data: { id: "s-1" }, error: null });

    const result = await createService({ organizationId: "org-1", name: "Coupe", price: 1000 });

    expect(result).toEqual({ serviceId: "s-1" });
    const insert = insertCalls.find((c) => c.table === "services");
    expect((insert!.rows as { status: string }).status).toBe("active");
  });
});

describe("updateService", () => {
  it("un statut omis ne touche pas la colonne", async () => {
    tableResults.set("services", { data: { id: "s-1" }, error: null });
    await updateService("s-1", "org-1", { name: "Coupe", price: 1000 });

    const update = updateCalls.find((c) => c.table === "services");
    expect(update!.patch).not.toHaveProperty("status");
  });

  it("lève NotFoundError si le service n'appartient pas à l'org", async () => {
    tableResults.set("services", { data: null, error: null });
    await expect(updateService("s-x", "org-1", { name: "Coupe", price: 1000 })).rejects.toThrow(/introuvable/i);
  });
});

describe("toggleServiceStatus", () => {
  it("met à jour uniquement le statut", async () => {
    tableResults.set("services", { data: { id: "s-1" }, error: null });
    await toggleServiceStatus("s-1", "org-1", "inactive");

    const update = updateCalls.find((c) => c.table === "services");
    expect(update!.patch).toEqual({ status: "inactive" });
  });
});
