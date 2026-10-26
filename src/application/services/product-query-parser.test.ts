import { describe, it, expect } from "vitest";
import { parseProductQuery, hasPriceFilter, detectCategoryListRequest, AROUND_TOLERANCE } from "./product-query-parser";

describe("parseProductQuery — budget", () => {
  it("« autour de 25 000 » → fourchette ±20 %, budget conservé", () => {
    const q = parseProductQuery("montre-moi des chaussures noires pour homme autour de 25 000");
    expect(q.priceIntent).toBe("around");
    expect(q.budget).toBe(25000);
    expect(q.minPrice).toBe(Math.round((25000 * (1 - AROUND_TOLERANCE)) / 100) * 100);
    expect(q.maxPrice).toBe(Math.round((25000 * (1 + AROUND_TOLERANCE)) / 100) * 100);
    expect(q.terms).toEqual(["chaussure", "noire", "homme"]);
  });

  it("le montant ne devient jamais un mot-clé (« 25000 FCFA »)", () => {
    const q = parseProductQuery("chaussures noires homme autour de 25000 FCFA");
    expect(q.terms).toEqual(["chaussure", "noire", "homme"]);
  });

  it.each([
    ["des baskets à moins de 20k", { maxPrice: 20000, minPrice: null, priceIntent: "max" }],
    ["chaussures noires pas plus de 25.000 francs", { maxPrice: 25000, minPrice: null, priceIntent: "max" }],
    ["budget 15 000 pour un sac", { maxPrice: 15000, minPrice: null, priceIntent: "max" }],
    ["plus de 50 000 pour un casque", { minPrice: 50000, maxPrice: null, priceIntent: "min" }],
    ["je cherche une robe entre 10 000 et 30 000", { minPrice: 10000, maxPrice: 30000, priceIntent: "between" }],
  ])("%s", (message, expected) => {
    expect(parseProductQuery(message)).toMatchObject(expected);
  });

  it("« entre » et les mots de budget ne sont pas des mots-clés", () => {
    expect(parseProductQuery("je cherche une robe entre 10 000 et 30 000").terms).toEqual(["robe"]);
  });

  it("garde les mots courts (« sac », « air », « max »)", () => {
    expect(parseProductQuery("budget 15 000 pour un sac").terms).toEqual(["sac"]);
    expect(parseProductQuery("Air Max").terms).toEqual(["air", "max"]);
  });

  it("« Air Max 25000 » : « max » n'est pas un plafond de prix", () => {
    const q = parseProductQuery("Air Max 25000");
    expect(q.priceIntent).toBe("around");
    expect(q.terms).toEqual(["air", "max"]);
  });

  it("ne prend ni une taille, ni une quantité, ni une année pour un prix", () => {
    expect(hasPriceFilter(parseProductQuery("jean taille 42"))).toBe(false);
    expect(hasPriceFilter(parseProductQuery("2 chemises"))).toBe(false);
    expect(hasPriceFilter(parseProductQuery("collection 2026 chemise"))).toBe(false);
  });

  it("sans budget : aucun filtre de prix", () => {
    const q = parseProductQuery("vous avez des sacs en cuir ?");
    expect(q).toMatchObject({ minPrice: null, maxPrice: null, budget: null, priceIntent: null });
  });
});

describe("detectCategoryListRequest", () => {
  it("reconnaît une demande de catégories", () => {
    expect(detectCategoryListRequest("Quelles catégories avez-vous ?")).toBe(true);
    expect(detectCategoryListRequest("vos rayons svp")).toBe(true);
  });
  it("ne se déclenche pas sur une demande produit", () => {
    expect(detectCategoryListRequest("vous avez des chaussures ?")).toBe(false);
  });
});
