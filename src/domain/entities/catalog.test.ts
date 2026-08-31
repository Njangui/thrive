import { describe, it, expect } from "vitest";
import { slugify } from "./catalog";

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
