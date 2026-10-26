import { describe, it, expect } from "vitest";
import { analyzeCatalogRows, guessColumnMapping, normalizeKey, parseAmount } from "./catalog-import-analysis";

const none = { names: new Set<string>(), skus: new Set<string>() };

describe("parseAmount", () => {
  it.each([
    ["35000", 35000],
    ["35 000 FCFA", 35000],
    ["35.000", 35000],
    ["1,500", 1500],
    ["1.234.567", 1234567],
    ["12,5", 12.5],
    ["12.50", 12.5],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["5000F", 5000],
    ["0", 0],
  ])("lit %s -> %s", (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it.each(["", "   ", "abc", "gratuit", "-500", "12,5,", "1.2.", "N/A", "sur devis"])("refuse %j (jamais inventé)", (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });
});

describe("guessColumnMapping", () => {
  it("reconnaît des en-têtes français désordonnés", () => {
    const m = guessColumnMapping(["Désignation", "Prix de vente (FCFA)", "Prix d'achat", "Qté", "Famille", "Réf.", "Photo", "Remarque"]);
    expect(m.fields.name).toBe("Désignation");
    expect(m.fields.price).toBe("Prix de vente (FCFA)");
    expect(m.fields.cost_price).toBe("Prix d'achat");
    expect(m.fields.stock).toBe("Qté");
    expect(m.fields.category).toBe("Famille");
    expect(m.fields.sku).toBe("Réf.");
    expect(m.fields.image_urls).toBe("Photo");
    expect(m.unmapped).toEqual(["Remarque"]);
  });

  it("ne confond pas « prix d'achat » avec le prix de vente", () => {
    const m = guessColumnMapping(["Produit", "Prix d'achat unitaire", "Tarif"]);
    expect(m.fields.cost_price).toBe("Prix d'achat unitaire");
    expect(m.fields.price).toBe("Tarif");
  });

  it("un en-tête n'alimente qu'un seul champ", () => {
    const m = guessColumnMapping(["Nom", "Prix"]);
    expect(Object.values(m.fields)).toEqual(["Nom", "Prix"]);
  });

  it("normalise accents et ponctuation", () => {
    expect(normalizeKey("  Prix d'Achat (FCFA) ")).toBe("prix d achat fcfa");
  });
});

describe("analyzeCatalogRows", () => {
  const headers = ["Nom", "Prix", "Stock", "Référence"];

  it("ne fabrique jamais prix ni stock : prix manquant = précision demandée", () => {
    const r = analyzeCatalogRows(
      [
        { Nom: "Sac", Prix: "15 000", Stock: "4", Référence: "S1" },
        { Nom: "Montre", Prix: "", Stock: "2", Référence: "M1" },
        { Nom: "Ceinture", Prix: "sur devis", Stock: "", Référence: "C1" },
      ],
      headers,
      none,
    );
    expect(r.ready.map((p) => p.name)).toEqual(["Sac"]);
    expect(r.needsClarification).toEqual([
      { row: 3, name: "Montre", reasons: ["prix manquant"] },
      { row: 4, name: "Ceinture", reasons: ["prix illisible"] },
    ]);
  });

  it("signale un stock vide sans l'inventer", () => {
    const r = analyzeCatalogRows([{ Nom: "Sac", Prix: "100", Stock: "", Référence: "" }], headers, none);
    expect(r.ready[0]).toMatchObject({ stock: 0, stockKnown: false });
  });

  it("détecte les doublons dans le fichier et dans le catalogue (nom normalisé, SKU)", () => {
    const r = analyzeCatalogRows(
      [
        { Nom: "Café Moulu", Prix: "1000", Stock: "1", Référence: "" },
        { Nom: "cafe  moulu", Prix: "1000", Stock: "1", Référence: "" },
        { Nom: "Thé", Prix: "500", Stock: "1", Référence: "T-1" },
        { Nom: "Infusion", Prix: "500", Stock: "1", Référence: "t-1" },
        { Nom: "Sucre", Prix: "300", Stock: "1", Référence: "" },
      ],
      headers,
      { names: new Set(["sucre"]), skus: new Set() },
    );
    expect(r.ready.map((p) => p.name)).toEqual(["Café Moulu", "Thé"]);
    expect(r.duplicates).toEqual([
      { row: 3, name: "cafe  moulu", reason: "name", scope: "file" },
      { row: 5, name: "Infusion", reason: "sku", scope: "file" },
      { row: 6, name: "Sucre", reason: "name", scope: "catalog" },
    ]);
  });

  it("avertit des colonnes ignorées et des colonnes clés absentes", () => {
    const r = analyzeCatalogRows([{ Produit: "A", Notes: "x" }], ["Produit", "Notes"], none);
    expect(r.warnings.join(" ")).toMatch(/prix/);
    expect(r.warnings.join(" ")).toMatch(/Notes/);
  });

  it("lit le prix d'achat et ignore proprement une valeur illisible", () => {
    const r = analyzeCatalogRows(
      [
        { Nom: "A", Prix: "100", "Prix d'achat": "60" },
        { Nom: "B", Prix: "100", "Prix d'achat": "?" },
      ],
      ["Nom", "Prix", "Prix d'achat"],
      none,
    );
    expect(r.ready[0]?.costPrice).toBe(60);
    expect(r.ready[1]?.costPrice).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/Ligne 3/);
  });
});
