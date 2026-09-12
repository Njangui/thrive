import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { listServices, createService, updateService, deleteService, formatServiceDiscoveryMessage } from "./service-catalog-service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listServices", () => {
  it("mappe les colonnes DB vers ServiceSummary, catégorie incluse", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                {
                  id: "s1",
                  name: "Coupe homme",
                  slug: "coupe-homme",
                  description: "Rapide et soignée",
                  price: 3000,
                  duration_minutes: 30,
                  status: "active",
                  categories: { name: "Coiffure" },
                },
              ],
              error: null,
            }),
        }),
      }),
    });

    const result = await listServices("org-1");
    expect(result).toEqual([
      {
        id: "s1",
        name: "Coupe homme",
        slug: "coupe-homme",
        description: "Rapide et soignée",
        categoryName: "Coiffure",
        priceFcfa: 3000,
        durationMinutes: 30,
        status: "active",
      },
    ]);
  });
});

describe("createService", () => {
  it("rejette un nom vide avant tout accès DB", async () => {
    await expect(createService({ organizationId: "org-1", name: "  ", priceFcfa: 1000 })).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejette un prix négatif avant tout accès DB", async () => {
    await expect(createService({ organizationId: "org-1", name: "Coupe", priceFcfa: -1 })).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("crée la prestation sans catégorie (aucun appel categories)", async () => {
    mockFrom.mockReturnValue({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "s1" }, error: null }) }) }),
    });

    const result = await createService({ organizationId: "org-1", name: "Coupe homme", priceFcfa: 3000 });
    expect(result).toEqual({ serviceId: "s1" });
    expect(mockFrom).toHaveBeenCalledWith("services");
    expect(mockFrom).not.toHaveBeenCalledWith("categories");
  });
});

describe("updateService / deleteService — critère IDOR (jamais l'org d'un autre tenant)", () => {
  it("updateService lève NotFoundError si aucune ligne n'a été affectée (mauvais org OU id inexistant)", async () => {
    mockFrom.mockReturnValue({
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null, count: 0 }) }) }),
    });

    await expect(updateService("org-1", "s1", { priceFcfa: 5000 })).rejects.toThrow();
  });

  it("deleteService lève NotFoundError si aucune ligne n'a été affectée", async () => {
    mockFrom.mockReturnValue({
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null, count: 0 }) }) }),
    });

    await expect(deleteService("org-1", "s1")).rejects.toThrow();
  });

  it("updateService réussit quand une ligne est affectée", async () => {
    mockFrom.mockReturnValue({
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null, count: 1 }) }) }),
    });

    await expect(updateService("org-1", "s1", { status: "inactive" })).resolves.toBeUndefined();
  });
});

describe("formatServiceDiscoveryMessage — jamais l'IA pour une info déjà structurée (section 90)", () => {
  it("liste nom, prix, durée, description", () => {
    const message = formatServiceDiscoveryMessage([
      { id: "s1", name: "Coupe homme", slug: "coupe-homme", description: "Rapide", categoryName: null, priceFcfa: 3000, durationMinutes: 30, status: "active" },
    ]);
    expect(message).toContain("Coupe homme");
    expect(message).toContain("30 min");
    expect(message).toContain("Rapide");
  });

  it("message de repli honnête quand aucune prestation ne correspond", () => {
    expect(formatServiceDiscoveryMessage([])).not.toContain("undefined");
  });
});
