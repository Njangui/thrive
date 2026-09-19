import { describe, it, expect } from "vitest";
import { slugify, CatalogSpecificationsSchema } from "./catalog";

describe("slugify", () => {
  it("convertit en minuscules et remplace les espaces par des tirets", () => {
    expect(slugify("Sneakers Nike Air Max")).toBe("sneakers-nike-air-max");
  });

  it("retire les accents (contexte francophone)", () => {
    expect(slugify("Écharpe en Laine Épaisse")).toBe("echarpe-en-laine-epaisse");
  });

  it("retire les caractères spéciaux", () => {
    expect(slugify("T-shirt \"Premium\" (2026) !!!")).toBe("t-shirt-premium-2026");
  });

  it("ne laisse pas de tirets en début/fin", () => {
    expect(slugify("  Robe rouge  ")).toBe("robe-rouge");
  });

  it("gère les tirets multiples consécutifs", () => {
    expect(slugify("Jean --- Slim")).toBe("jean-slim");
  });
});

describe("CatalogSpecificationsSchema", () => {
  it("accepte une liste de paires libellé/valeur", () => {
    const result = CatalogSpecificationsSchema.safeParse([
      { label: "Matière", value: "Coton" },
      { label: "Garantie", value: "6 mois" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejette une entrée sans libellé ou sans valeur", () => {
    expect(CatalogSpecificationsSchema.safeParse([{ label: "", value: "Coton" }]).success).toBe(false);
    expect(CatalogSpecificationsSchema.safeParse([{ label: "Matière", value: "" }]).success).toBe(false);
  });

  it("rejette au-delà de 12 lignes", () => {
    const tooMany = Array.from({ length: 13 }, (_, i) => ({ label: `Ligne ${i}`, value: "x" }));
    expect(CatalogSpecificationsSchema.safeParse(tooMany).success).toBe(false);
  });

  it("accepte une liste vide (informations retirées explicitement)", () => {
    expect(CatalogSpecificationsSchema.safeParse([]).success).toBe(true);
  });
});
