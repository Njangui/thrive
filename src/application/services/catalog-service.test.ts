import { describe, it, expect } from "vitest";
import { formatProductDiscoveryMessage } from "./catalog-service";
import type { CatalogProductSummary } from "./catalog-service";

const PRODUCTS: CatalogProductSummary[] = [
  {
    id: "p1",
    name: "Sneakers Air Max",
    slug: "sneakers-air-max",
    unitPrice: 35000,
    description: "Confortables et légères",
    categoryName: "Chaussures",
  },
  {
    id: "p2",
    name: "T-shirt Premium",
    slug: "t-shirt-premium",
    unitPrice: 12000,
    description: null,
    categoryName: null,
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
