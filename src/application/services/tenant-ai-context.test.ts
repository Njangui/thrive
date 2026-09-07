import { describe, it, expect } from "vitest";
import { formatRecentProductsForAIContext } from "./tenant-ai-context";
import type { CatalogProductSummary } from "./catalog-service";

describe("formatRecentProductsForAIContext (Lot D, section 21/24)", () => {
  it("mentionne nom, prix et description des produits récemment montrés dans la conversation", () => {
    const products: CatalogProductSummary[] = [
      {
        id: "p3",
        name: "Robe imprimée",
        slug: "robe-imprimee",
        unitPrice: 25000,
        description: "Coupe fluide, motif wax",
        categoryName: "Vêtements",
      },
    ];

    const context = formatRecentProductsForAIContext(products);

    expect(context).toContain("Robe imprimée");
    // fr-FR utilise une espace fine insécable (U+202F) comme séparateur de
    // milliers — on matche sur les chiffres et "FCFA", comme dans
    // catalog-service.test.ts.
    expect(context).toMatch(/25.000\sFCFA/);
    expect(context).toContain("Coupe fluide, motif wax");
  });

  it("retourne une chaîne vide quand aucun produit n'a été mentionné (rien à injecter)", () => {
    expect(formatRecentProductsForAIContext([])).toBe("");
  });

  it("ne plante pas et n'affiche pas 'undefined' pour un produit sans description", () => {
    const products: CatalogProductSummary[] = [
      { id: "p1", name: "Sneakers Air Max", slug: "sneakers-air-max", unitPrice: 35000, description: null, categoryName: null },
    ];

    const context = formatRecentProductsForAIContext(products);

    expect(context).toContain("Sneakers Air Max");
    expect(context).not.toContain("undefined");
    expect(context).not.toContain("null");
  });
});
