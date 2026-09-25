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
  addProductSpecification,
  removeProductSpecification,
  getProductBySlug,
  isPromotionCurrentlyOn,
  buildProductButtons,
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

describe("addProductSpecification", () => {
  it("ajoute une ligne à la fin de la liste existante", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { specifications: [{ label: "Matière", value: "Coton" }] },
      error: null,
    });
    const update = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) });
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
      update,
    });

    await addProductSpecification("org-1", "prod-1", "Garantie", "6 mois");

    expect(update).toHaveBeenCalledWith({
      specifications: [
        { label: "Matière", value: "Coton" },
        { label: "Garantie", value: "6 mois" },
      ],
    });
  });

  it("refuse un libellé vide plutôt que d'enregistrer une ligne invalide", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { specifications: [] }, error: null });
    const update = vi.fn();
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }), update });

    await expect(addProductSpecification("org-1", "prod-1", "", "Coton")).rejects.toThrow(/Informations invalides/);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuse une 13e ligne (limite de 12)", async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ label: `Ligne ${i}`, value: "x" }));
    const maybeSingle = vi.fn().mockResolvedValue({ data: { specifications: twelve }, error: null });
    const update = vi.fn();
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }), update });

    await expect(addProductSpecification("org-1", "prod-1", "Treizième", "x")).rejects.toThrow(/Informations invalides/);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("removeProductSpecification", () => {
  it("retire uniquement la ligne à l'index donné", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        specifications: [
          { label: "Matière", value: "Coton" },
          { label: "Garantie", value: "6 mois" },
        ],
      },
      error: null,
    });
    const update = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) });
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
      update,
    });

    await removeProductSpecification("org-1", "prod-1", 0);

    expect(update).toHaveBeenCalledWith({ specifications: [{ label: "Garantie", value: "6 mois" }] });
  });
});

describe("getProductBySlug — compte à rebours honnête (itération 2, 0057)", () => {
  function mockProductRow(overrides: { compare_at_price: number | null; promotion_ends_at: string | null }) {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "p1",
        name: "Sneakers",
        slug: "sneakers",
        unit_price: 20000,
        current_stock: 5,
        status: "active",
        description: null,
        seo_title: null,
        seo_description: null,
        specifications: null,
        categories: null,
        product_images: [],
        ...overrides,
      },
      error: null,
    });
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) });
  }

  it("expose le prix barré et l'échéance quand la promotion est encore active", async () => {
    const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    mockProductRow({ compare_at_price: 25000, promotion_ends_at: futureDate });

    const product = await getProductBySlug("org-1", "sneakers");
    expect(product?.compareAtPrice).toBe(25000);
    expect(product?.promotionEndsAt).toBe(futureDate);
  });

  it("masque le prix barré ET l'échéance une fois la promotion expirée — jamais un compte à rebours figé à zéro", async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    mockProductRow({ compare_at_price: 25000, promotion_ends_at: pastDate });

    const product = await getProductBySlug("org-1", "sneakers");
    expect(product?.compareAtPrice).toBeNull();
    expect(product?.promotionEndsAt).toBeNull();
  });

  it("garde le prix barré actif indéfiniment sans échéance configurée (comportement historique inchangé)", async () => {
    mockProductRow({ compare_at_price: 25000, promotion_ends_at: null });

    const product = await getProductBySlug("org-1", "sneakers");
    expect(product?.compareAtPrice).toBe(25000);
    expect(product?.promotionEndsAt).toBeNull();
  });
});

describe("isPromotionCurrentlyOn — règle unique partagée (catalogue V2 + vitrine)", () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  it("faux sans prix barré, ou avec un prix barré inférieur ou égal au prix de vente (saisie erronée)", () => {
    expect(isPromotionCurrentlyOn(null, 20000, null)).toBe(false);
    expect(isPromotionCurrentlyOn(20000, 20000, null)).toBe(false);
    expect(isPromotionCurrentlyOn(15000, 20000, future)).toBe(false);
  });

  it("vrai sans échéance (comportement historique) et avec une échéance future", () => {
    expect(isPromotionCurrentlyOn(25000, 20000, null)).toBe(true);
    expect(isPromotionCurrentlyOn(25000, 20000, future)).toBe(true);
  });

  it("faux une fois l'échéance dépassée", () => {
    expect(isPromotionCurrentlyOn(25000, 20000, past)).toBe(false);
  });

  it("une échéance illisible ne désactive jamais silencieusement une promotion existante", () => {
    expect(isPromotionCurrentlyOn(25000, 20000, "pas-une-date")).toBe(true);
  });
});

describe("buildProductButtons", () => {
  const ORIGIN = "https://monsalon.flexco .app";

  it("un seul produit -> un seul bouton \"Voir plus\" vers son lien", () => {
    const buttons = buildProductButtons([PRODUCTS[0]!], ORIGIN);
    expect(buttons).toEqual([{ text: "Voir plus", url: `${ORIGIN}/produits/sneakers-air-max` }]);
  });

  it("plusieurs produits -> un bouton par produit, libellé avec son nom, dans l'ordre", () => {
    const buttons = buildProductButtons(PRODUCTS, ORIGIN);
    expect(buttons[0]).toEqual({ text: "Voir : Sneakers Air Max", url: `${ORIGIN}/produits/sneakers-air-max` });
    expect(buttons[1]).toEqual({ text: "Voir : T-shirt Premium", url: `${ORIGIN}/produits/t-shirt-premium` });
  });

  it("ignore les produits sans slug (aucune fiche publique à lier)", () => {
    const buttons = buildProductButtons([{ ...PRODUCTS[0]!, slug: null }], ORIGIN);
    expect(buttons).toEqual([]);
  });

  it("tronque un libellé trop long pour rester sous la limite de 64 caractères de l'API Bot Telegram", () => {
    const longName = "Appartement meublé haut standing avec vue panoramique sur toute la ville et piscine privée";
    const buttons = buildProductButtons([PRODUCTS[0]!, { ...PRODUCTS[1]!, name: longName }], ORIGIN);
    const longButton = buttons[1];
    expect(longButton).toBeDefined();
    expect(longButton!.text.length).toBeLessThanOrEqual(64);
    expect(longButton!.text.endsWith("…")).toBe(true);
  });
});
