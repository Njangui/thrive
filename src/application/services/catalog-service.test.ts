import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import {
  formatProductDiscoveryMessage,
  createCategory,
  deleteCategory,
  seedDefaultCategories,
} from "./catalog-service";
import type { CatalogProductSummary } from "./catalog-service";

beforeEach(() => {
  vi.clearAllMocks();
});

const PRODUCTS: CatalogProductSummary[] = [
  {
    id: "p1",
    name: "Sneakers Air Max",
    slug: "sneakers-air-max",
    unitPrice: 35000,
    description: "Confortables et légères",
    categoryName: "Chaussures",
    imageUrl: null,
  },
  {
    id: "p2",
    name: "T-shirt Premium",
    slug: "t-shirt-premium",
    unitPrice: 12000,
    description: null,
    categoryName: null,
    imageUrl: null,
  },
];

describe("formatProductDiscoveryMessage", () => {
  it("liste chaque produit avec nom, prix, catégorie, description, lien (section 15)", () => {
    const message = formatProductDiscoveryMessage(PRODUCTS, "https://monsalon.sme-os.app", "https://monsalon.sme-os.app/produits");

    expect(message).toContain("Sneakers Air Max");
    // fr-FR utilise une espace fine insécable (U+202F) comme séparateur de
    // milliers, pas une espace normale — on matche sur les chiffres et
    // "FCFA" plutôt que de dépendre du caractère exact.
    expect(message).toMatch(/35.000\sFCFA/);
    expect(message).toContain("Chaussures");
    expect(message).toContain("Confortables et légères");
    expect(message).toContain("https://monsalon.sme-os.app/produits/sneakers-air-max");
    expect(message).toContain("T-shirt Premium");
    expect(message).toMatch(/12.000\sFCFA/);
    expect(message).toContain("Voir tous les produits");
  });

  it("ne plante pas et propose une alternative si le catalogue est vide (jamais inventer de produit)", () => {
    const message = formatProductDiscoveryMessage([], "https://x.sme-os.app", "https://x.sme-os.app/produits");
    expect(message).not.toContain("undefined");
    expect(message.length).toBeGreaterThan(0);
  });
});

describe("createCategory", () => {
  it("refuse un nom qui existe déjà (même slug) plutôt que de créer un doublon silencieux", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "cat-1" }, error: null });
    const insert = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      expect(table).toBe("categories");
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
        insert,
      };
    });

    await expect(createCategory("org-1", "Chaussures")).rejects.toThrow(/existe déjà/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("crée la catégorie avec un slug normalisé quand le nom est nouveau", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const single = vi.fn().mockResolvedValue({ data: { id: "cat-2", name: "Vêtements Femme" }, error: null });
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
      insert,
    });

    const result = await createCategory("org-1", "  Vêtements Femme  ");

    expect(result).toEqual({ id: "cat-2", name: "Vêtements Femme" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: "org-1", name: "Vêtements Femme", slug: "vetements-femme" }),
    );
  });
});

describe("deleteCategory", () => {
  it("détache les produits/services de la catégorie avant de la supprimer (jamais bloqué par la contrainte de clé étrangère)", async () => {
    const calls: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      calls.push(table);
      if (table === "products" || table === "services") {
        return { update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) };
      }
      return { delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) };
    });

    await deleteCategory("org-1", "cat-1");

    expect(calls).toEqual(["products", "services", "categories"]);
  });
});

describe("seedDefaultCategories", () => {
  it("n'insère rien si l'organisation a déjà au moins une catégorie (idempotent — rejouable sans dupliquer)", async () => {
    const insert = vi.fn();
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ count: 3, error: null }) }),
      insert,
    });

    await seedDefaultCategories("org-1", "retail");

    expect(insert).not.toHaveBeenCalled();
  });

  it("utilise le preset du secteur d'activité quand il est connu", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }),
      insert,
    });

    await seedDefaultCategories("org-1", "restaurant");

    const rows = insert.mock.calls[0]![0] as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["Entrées", "Plats", "Desserts", "Boissons", "Menus", "Autres"]);
  });

  it("retombe sur le preset générique si le secteur est inconnu ou absent", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }),
      insert,
    });

    await seedDefaultCategories("org-1", null);

    const rows = insert.mock.calls[0]![0] as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["Général", "Autres"]);
  });
});
