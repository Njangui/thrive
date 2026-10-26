import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ rpc: mockRpc, from: mockFrom }),
}));

import { searchProducts, browseProducts, formatProductSearchReply, describePriceRequest, formatCategoryListReply } from "./product-search-service";
import { parseProductQuery } from "./product-query-parser";

const ORG = "org_1";
const flat = (text: string) => text.replace(/[\u202f\u00a0]/g, " ");
const row = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Derby cuir noir",
  slug: "derby-cuir-noir",
  unit_price: "24500",
  compare_at_price: null,
  description: null,
  category_name: "Chaussures",
  is_promo: false,
  image_url: null,
  score: 3.2,
  ...over,
});

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe("searchProducts", () => {
  it("passe l'organisation et les filtres à la fonction SQL (isolation + prix en base)", async () => {
    mockRpc.mockResolvedValue({ data: [row()], error: null });

    const outcome = await searchProducts(ORG, parseProductQuery("chaussures noires homme autour de 25000"));

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("search_products_for_assistant", {
      p_organization_id: ORG,
      p_terms: ["chaussure", "noire", "homme"],
      p_min_price: 20000,
      p_max_price: 30000,
      p_category_slug: null,
      p_limit: 3,
    });
    expect(outcome.relaxed).toBe(false);
    expect(outcome.products[0]).toMatchObject({ id: "p1", unitPrice: 24500, categoryName: "Chaussures", isPromo: false });
  });

  it("rien dans le budget : relâche le prix, trie par proximité du budget et le signale (relaxed)", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [row({ id: "far", unit_price: 90000 }), row({ id: "near", unit_price: 32000 }), row({ id: "mid", unit_price: 45000 })],
        error: null,
      });

    const outcome = await searchProducts(ORG, parseProductQuery("chaussures noires autour de 25000"), { limit: 2 });

    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc.mock.calls[1]![1]).toMatchObject({ p_min_price: null, p_max_price: null });
    expect(outcome.relaxed).toBe(true);
    expect(outcome.products.map((p) => p.id)).toEqual(["near", "mid"]);
  });

  it("sans budget et sans résultat : une seule requête, pas de relâchement", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const outcome = await searchProducts(ORG, parseProductQuery("des chaussures noires"));
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ products: [], relaxed: false });
  });

  it("aucun mot : pas d'appel base (le parcours se fait par browseProducts)", async () => {
    const outcome = await searchProducts(ORG, parseProductQuery("bonjour"));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(outcome.products).toEqual([]);
  });

  it("une erreur SQL remonte (l'orchestrateur bascule sur l'ancienne recherche)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    await expect(searchProducts(ORG, parseProductQuery("des sacs"))).rejects.toThrow(/Erreur recherche produit/);
  });

  it("borne la limite demandée", async () => {
    mockRpc.mockResolvedValue({ data: [row()], error: null });
    await searchProducts(ORG, parseProductQuery("des sacs"), { limit: 999 });
    expect(mockRpc.mock.calls[0]![1].p_limit).toBe(10);
  });
});

describe("browseProducts", () => {
  it("appelle la fonction sans mots (tri par règles métier) avec l'organisation", async () => {
    mockRpc.mockResolvedValue({ data: [row()], error: null });
    await browseProducts(ORG, { minPrice: null, maxPrice: null, budget: null, priceIntent: null }, { limit: 5 });
    expect(mockRpc).toHaveBeenCalledWith("search_products_for_assistant", expect.objectContaining({ p_organization_id: ORG, p_terms: [], p_limit: 5 }));
  });
});

describe("formatage", () => {
  const ctx = { publicBaseUrl: "https://shop.example", catalogUrl: "https://shop.example/produits", itemLabelPlural: "produits" };

  it("reformule le budget avec les chiffres du client", () => {
    expect(flat(describePriceRequest(parseProductQuery("sac autour de 25000"))!)).toBe("autour de 25 000 FCFA");
    expect(flat(describePriceRequest(parseProductQuery("sac moins de 20k"))!)).toBe("à moins de 20 000 FCFA");
    expect(flat(describePriceRequest(parseProductQuery("sac entre 10 000 et 30 000"))!)).toBe("entre 10 000 FCFA et 30 000 FCFA");
    expect(describePriceRequest(parseProductQuery("un sac"))).toBeNull();
  });

  it("n'affiche le prix barré que pour une promotion en cours", () => {
    const text = flat(
      formatProductSearchReply(
        [
          { id: "a", name: "A", slug: "a", unitPrice: 15000, description: null, categoryName: null, imageUrl: null, compareAtPrice: 20000, isPromo: true, score: 1 },
          { id: "b", name: "B", slug: "b", unitPrice: 16000, description: null, categoryName: null, imageUrl: null, compareAtPrice: 20000, isPromo: false, score: 1 },
        ],
        { ...ctx, priceRequest: parseProductQuery("sac autour de 15000"), relaxed: false },
      ),
    );
    expect(text).toContain("15 000 FCFA (au lieu de 20 000 FCFA)");
    expect(text).toContain("16 000 FCFA\n");
    expect(text).not.toContain("16 000 FCFA (au lieu");
  });

  it("annonce « rien trouvé » quand le prix est relâché", () => {
    const text = flat(
      formatProductSearchReply(
        [{ id: "a", name: "A", slug: null, unitPrice: 42000, description: null, categoryName: null, imageUrl: null, compareAtPrice: null, isPromo: false, score: 1 }],
        { ...ctx, priceRequest: parseProductQuery("sac moins de 20k"), relaxed: true },
      ),
    );
    expect(text.startsWith("Je n'ai rien trouvé à moins de 20 000 FCFA.")).toBe(true);
  });

  it("raccourcit les longues descriptions", () => {
    const text = formatProductSearchReply(
      [{ id: "a", name: "A", slug: null, unitPrice: 1000, description: "mot ".repeat(100), categoryName: null, imageUrl: null, compareAtPrice: null, isPromo: false, score: 1 }],
      { ...ctx, priceRequest: parseProductQuery("sac"), relaxed: false },
    );
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(400);
  });

  it("liste les catégories avec leurs effectifs", () => {
    const text = formatCategoryListReply([{ name: "Chaussures", slug: "chaussures", productCount: 12 }], "https://shop.example/produits", "produits");
    expect(text).toContain("• Chaussures (12)");
  });
});
