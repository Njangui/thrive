import { describe, it, expect } from "vitest";
import { CsvRowSchema, parseImageUrls, resolveImageUrls, parseSpecifications } from "./catalog-import-service";

describe("CsvRowSchema (import CSV catalogue, section 11)", () => {
  it("accepte une ligne minimale valide", () => {
    const result = CsvRowSchema.safeParse({ name: "Sneakers Air Max", price: "35000" });
    expect(result.success).toBe(true);
  });

  it("accepte une ligne complète", () => {
    const result = CsvRowSchema.safeParse({
      name: "Jean Slim",
      price: "18000",
      category: "Vêtements",
      description: "Coupe ajustée",
      stock: "12",
      status: "active",
    });
    expect(result.success).toBe(true);
  });

  it("rejette une ligne sans nom", () => {
    const result = CsvRowSchema.safeParse({ price: "1000" });
    expect(result.success).toBe(false);
  });

  it("rejette un prix négatif", () => {
    const result = CsvRowSchema.safeParse({ name: "Produit", price: "-500" });
    expect(result.success).toBe(false);
  });

  it("rejette un statut hors de l'énumération autorisée (section 9 : DRAFT/ACTIVE/OUT_OF_STOCK/INACTIVE)", () => {
    const result = CsvRowSchema.safeParse({ name: "Produit", price: "1000", status: "supprime" });
    expect(result.success).toBe(false);
  });

  it("stock par défaut à 0 si absent", () => {
    const result = CsvRowSchema.safeParse({ name: "Produit", price: "1000" });
    if (result.success) {
      expect(result.data.stock).toBe(0);
    } else {
      throw new Error("parsing attendu réussi");
    }
  });
});

describe("parseImageUrls (import CSV — plusieurs photos par produit)", () => {
  it("sépare sur | et retire les espaces", () => {
    expect(parseImageUrls("https://a.test/1.jpg | https://a.test/2.jpg")).toEqual([
      "https://a.test/1.jpg",
      "https://a.test/2.jpg",
    ]);
  });

  it("ignore une URL cassée sans bloquer les autres", () => {
    expect(parseImageUrls("https://a.test/1.jpg|pas-une-url|https://a.test/3.jpg")).toEqual([
      "https://a.test/1.jpg",
      "https://a.test/3.jpg",
    ]);
  });

  it("valeur absente -> liste vide", () => {
    expect(parseImageUrls(undefined)).toEqual([]);
  });
});

describe("resolveImageUrls (image_urls prioritaire sur image_url)", () => {
  it("utilise image_urls quand les deux colonnes sont renseignées", () => {
    expect(resolveImageUrls({ image_url: "https://a.test/old.jpg", image_urls: "https://a.test/1.jpg|https://a.test/2.jpg" })).toEqual([
      "https://a.test/1.jpg",
      "https://a.test/2.jpg",
    ]);
  });

  it("retombe sur image_url si image_urls est absente (compatibilité)", () => {
    expect(resolveImageUrls({ image_url: "https://a.test/old.jpg" })).toEqual(["https://a.test/old.jpg"]);
  });

  it("aucune colonne renseignée -> liste vide", () => {
    expect(resolveImageUrls({})).toEqual([]);
  });
});

describe("parseSpecifications (import CSV — informations complémentaires)", () => {
  it("parse plusieurs paires libellé:valeur", () => {
    expect(parseSpecifications("Matière:Coton|Garantie:6 mois")).toEqual([
      { label: "Matière", value: "Coton" },
      { label: "Garantie", value: "6 mois" },
    ]);
  });

  it("ignore une entrée sans ':' plutôt que de faire échouer les autres", () => {
    expect(parseSpecifications("Matière:Coton|entrée invalide|Garantie:6 mois")).toEqual([
      { label: "Matière", value: "Coton" },
      { label: "Garantie", value: "6 mois" },
    ]);
  });

  it("plafonne à 12 paires", () => {
    const raw = Array.from({ length: 15 }, (_, i) => `Ligne ${i}:valeur`).join("|");
    expect(parseSpecifications(raw)).toHaveLength(12);
  });

  it("valeur absente -> liste vide", () => {
    expect(parseSpecifications(undefined)).toEqual([]);
  });
});
