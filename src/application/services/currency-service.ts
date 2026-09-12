import { ValidationError } from "@/lib/errors";

/**
 * Country Engine — Currency Engine (section 15/16 du master prompt
 * d'expansion). Remplace l'hypothèse implicite "FCFA partout" qui
 * traversait le projet (`src/lib/format.ts::formatPrice`,
 * `plans.price_fcfa`, `subscription_payments.amount_fcfa`) par un
 * système de devise explicite : tout montant est désormais toujours
 * accompagné d'un `currencyCode` (ISO 4217), jamais supposé.
 *
 * Table statique volontaire (pas d'appel réseau pour formater un
 * montant) : NotchPay expose bien `GET /resources/currencies/{code}`
 * (avec `decimal_places`, confirmé via developer.notchpay.co le
 * 06/09/2026), mais formater un prix est une opération beaucoup trop
 * fréquente (chaque rendu de page tarifs, chaque ligne de facturation)
 * pour dépendre d'un appel API à chaque fois — cohérent avec la
 * philosophie "ne pas sur-engineer" (section 49). Cette table est le
 * SEUL endroit à étendre quand le Super Admin active un pays dont la
 * devise n'y figure pas encore (voir docs/country-engine.md).
 */

export interface CurrencyMeta {
  code: string;
  name: string;
  symbol: string;
  /** Nombre de décimales de la plus petite unité (ISO 4217 "minor unit"). 0 pour XAF/XOF (pas de centime usité). */
  decimalDigits: number;
}

/**
 * CONFIRMÉ pour XAF/XOF via NotchPay (GET /resources/currencies,
 * consulté 06/09/2026 : `decimal_places: 0`). Les autres entrées
 * suivent la norme ISO 4217 usuelle — à re-vérifier via
 * `notchpay-resources-service.ts::syncCurrencyMetadata` (best-effort)
 * si un écart est constaté en production, mais ne bloque jamais le
 * fonctionnement de base : cette table statique reste la source de
 * vérité par défaut (section 9 : ne jamais dépendre de la disponibilité
 * de NotchPay pour une opération aussi basique que formater un prix).
 */
const CURRENCIES: Record<string, CurrencyMeta> = {
  XAF: { code: "XAF", name: "Franc CFA (CEMAC)", symbol: "FCFA", decimalDigits: 0 },
  XOF: { code: "XOF", name: "Franc CFA (UEMOA)", symbol: "CFA", decimalDigits: 0 },
  GHS: { code: "GHS", name: "Cedi ghanéen", symbol: "GH₵", decimalDigits: 2 },
  NGN: { code: "NGN", name: "Naira nigérian", symbol: "₦", decimalDigits: 2 },
  KES: { code: "KES", name: "Shilling kényan", symbol: "KSh", decimalDigits: 2 },
  UGX: { code: "UGX", name: "Shilling ougandais", symbol: "USh", decimalDigits: 0 },
  RWF: { code: "RWF", name: "Franc rwandais", symbol: "RF", decimalDigits: 0 },
  TZS: { code: "TZS", name: "Shilling tanzanien", symbol: "TSh", decimalDigits: 2 },
  CDF: { code: "CDF", name: "Franc congolais", symbol: "FC", decimalDigits: 2 },
  GNF: { code: "GNF", name: "Franc guinéen", symbol: "FG", decimalDigits: 0 },
  ZAR: { code: "ZAR", name: "Rand sud-africain", symbol: "R", decimalDigits: 2 },
  EGP: { code: "EGP", name: "Livre égyptienne", symbol: "E£", decimalDigits: 2 },
  MAD: { code: "MAD", name: "Dirham marocain", symbol: "DH", decimalDigits: 2 },
  USD: { code: "USD", name: "Dollar américain", symbol: "$", decimalDigits: 2 },
  EUR: { code: "EUR", name: "Euro", symbol: "€", decimalDigits: 2 },
};

/**
 * Repli pour une devise inconnue de la table statique : 2 décimales
 * (la convention ISO 4217 la plus répandue), JAMAIS 0 — arrondir
 * silencieusement une devise à sous-unité (ex: un futur GHS mal
 * répertorié) tronquerait des montants réels. Une devise qui atteint ce
 * repli doit être ajoutée à `CURRENCIES` dès que constatée (voir
 * `admin-countries-service.ts`, qui avertit dans ce cas).
 */
const DEFAULT_DECIMAL_DIGITS = 2;

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export function isKnownCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code.toUpperCase());
}

export function listKnownCurrencies(): CurrencyMeta[] {
  return Object.values(CURRENCIES);
}

export function getCurrencyMeta(code: string): CurrencyMeta {
  const upper = code.toUpperCase();
  return CURRENCIES[upper] ?? { code: upper, name: upper, symbol: upper, decimalDigits: DEFAULT_DECIMAL_DIGITS };
}

/**
 * Valide un couple (montant, devise) avant toute écriture financière
 * (section 62 : toute entrée validée côté serveur). Le montant DOIT être
 * un entier exprimé dans la plus petite unité de la devise (jamais un
 * flottant, section 16) — c'est la même discipline que
 * `subscription_payments.amount_fcfa integer` déjà en place, étendue à
 * toute devise.
 */
export function validateMoney(amount: number, currencyCode: string): void {
  if (typeof currencyCode !== "string" || !CURRENCY_CODE_PATTERN.test(currencyCode)) {
    throw new ValidationError(`Code devise invalide : "${currencyCode}" (attendu 3 lettres ISO 4217, ex: XAF).`);
  }
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0) {
    throw new ValidationError(
      "Le montant doit être un entier positif exprimé dans la plus petite unité de la devise (jamais un nombre décimal).",
    );
  }
}

/**
 * Convertit un montant "humain" (ex: 50 pour 50 GHS, saisi par le Super
 * Admin dans un formulaire) vers l'entier stocké en base, dans la plus
 * petite unité de la devise. Une seule multiplication + un seul
 * arrondi — jamais de chaîne d'opérations flottantes sur un montant
 * financier (section 16). Pour XAF/XOF (0 décimale), c'est une
 * identité : `normalizeMoney(15000, "XAF") === 15000`, ce qui préserve
 * exactement la sémantique historique de `plans.price_fcfa`.
 */
export function normalizeMoney(amountMajorUnits: number, currencyCode: string): number {
  if (!Number.isFinite(amountMajorUnits) || amountMajorUnits < 0) {
    throw new ValidationError("Le montant doit être un nombre positif.");
  }
  const meta = getCurrencyMeta(currencyCode);
  return Math.round(amountMajorUnits * 10 ** meta.decimalDigits);
}

/**
 * Formate un montant déjà stocké (plus petite unité de la devise) pour
 * affichage humain. Remplace l'hypothèse FCFA globale de
 * `src/lib/format.ts::formatPrice` — ce dernier reste en place pour ne
 * pas casser ses appelants existants (produits/services d'un tenant
 * camerounais), mais tout nouveau code multi-devise doit utiliser
 * `formatMoney(amount, currencyCode)` à la place, jamais supposer FCFA.
 */
export function formatMoney(amountMinorUnits: number, currencyCode: string, locale = "fr-FR"): string {
  const meta = getCurrencyMeta(currencyCode);
  const majorUnits = amountMinorUnits / 10 ** meta.decimalDigits;
  const formatted = majorUnits.toLocaleString(locale, {
    minimumFractionDigits: meta.decimalDigits,
    maximumFractionDigits: meta.decimalDigits,
  });
  return `${formatted} ${meta.symbol}`;
}
