import { describe, it, expect } from "vitest";
import {
  isKnownCurrency,
  getCurrencyMeta,
  validateMoney,
  normalizeMoney,
  formatMoney,
} from "./currency-service";
import { ValidationError } from "@/lib/errors";

describe("getCurrencyMeta / isKnownCurrency", () => {
  it("connaît XAF avec 0 décimale (pas de sous-unité usitée)", () => {
    expect(isKnownCurrency("XAF")).toBe(true);
    expect(getCurrencyMeta("XAF")).toEqual({ code: "XAF", name: "Franc CFA (CEMAC)", symbol: "FCFA", decimalDigits: 0 });
  });

  it("connaît GHS avec 2 décimales", () => {
    expect(getCurrencyMeta("GHS").decimalDigits).toBe(2);
  });

  it("est insensible à la casse", () => {
    expect(isKnownCurrency("xaf")).toBe(true);
    expect(getCurrencyMeta("xaf").code).toBe("XAF");
  });

  it("une devise inconnue retombe sur 2 décimales par défaut (jamais 0, pour ne jamais tronquer silencieusement)", () => {
    expect(isKnownCurrency("ZZZ")).toBe(false);
    expect(getCurrencyMeta("ZZZ")).toEqual({ code: "ZZZ", name: "ZZZ", symbol: "ZZZ", decimalDigits: 2 });
  });
});

describe("validateMoney", () => {
  it("accepte un montant entier positif avec un code devise ISO 4217 valide", () => {
    expect(() => validateMoney(15000, "XAF")).not.toThrow();
  });

  it("refuse un montant flottant (jamais de calcul flottant sur un montant financier)", () => {
    expect(() => validateMoney(150.5, "XAF")).toThrow(ValidationError);
  });

  it("refuse un montant négatif", () => {
    expect(() => validateMoney(-1, "XAF")).toThrow(ValidationError);
  });

  it("refuse un code devise qui n'est pas 3 lettres majuscules", () => {
    expect(() => validateMoney(100, "xaf")).toThrow(ValidationError);
    expect(() => validateMoney(100, "XA")).toThrow(ValidationError);
    expect(() => validateMoney(100, "XAFF")).toThrow(ValidationError);
  });
});

describe("normalizeMoney", () => {
  it("XAF (0 décimale) : identité — préserve la sémantique historique de plans.price_fcfa", () => {
    expect(normalizeMoney(15000, "XAF")).toBe(15000);
  });

  it("GHS (2 décimales) : convertit les unités majeures en centimes", () => {
    expect(normalizeMoney(50, "GHS")).toBe(5000);
  });

  it("arrondit une seule fois, sans dérive flottante", () => {
    expect(normalizeMoney(19.999, "GHS")).toBe(2000); // 19.999 * 100 = 1999.9 -> round -> 2000
  });

  it("refuse un montant négatif", () => {
    expect(() => normalizeMoney(-5, "XAF")).toThrow(ValidationError);
  });
});

describe("formatMoney", () => {
  // Le séparateur de milliers exact rendu par Intl fr-FR dépend des données
  // ICU du runtime (espace normale vs espace fine insécable U+202F selon
  // les versions de Node) — on le calcule ici via toLocaleString plutôt que
  // de le coder en dur, pour ne jamais faire dépendre ce test d'un détail
  // d'environnement non garanti par le contrat de formatMoney lui-même.
  it("XAF : affiche l'entier tel quel avec le symbole FCFA", () => {
    expect(formatMoney(15000, "XAF")).toBe(`${(15000).toLocaleString("fr-FR")} FCFA`);
  });

  it("GHS : affiche 2 décimales converties depuis les centimes", () => {
    const expected = (50).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(formatMoney(5000, "GHS")).toBe(`${expected} GH₵`);
  });

  it("round-trip normalizeMoney -> formatMoney reste cohérent", () => {
    const stored = normalizeMoney(1234.5, "NGN");
    const expected = (1234.5).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(formatMoney(stored, "NGN")).toBe(`${expected} ₦`);
  });
});
