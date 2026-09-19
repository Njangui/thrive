import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { searchServicesByName, formatServiceDiscoveryMessage } from "./service-catalog-service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchServicesByName", () => {
  it("mappe les colonnes DB vers ServiceSummary, catégorie incluse", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            ilike: () => ({
              limit: () =>
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
        }),
      }),
    });

    const result = await searchServicesByName("org-1", "coupe");
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
