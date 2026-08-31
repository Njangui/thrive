import { describe, it, expect } from "vitest";
import { CsvRowSchema } from "./catalog-import-service";

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
