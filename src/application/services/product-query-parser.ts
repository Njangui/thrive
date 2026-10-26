import { extractSearchTerms, singularize, tokenize } from "./message-intents";

/**
 * C3 — compréhension DÉTERMINISTE d'une demande produit (aucune I/O, aucun
 * appel IA : principe 2, règles avant IA). Extrait ce qui se calcule sans
 * modèle : le budget (« autour de 25 000 », « moins de 20k », « entre 10 000
 * et 30 000 ») et les mots significatifs à chercher. Le budget est un FILTRE
 * numérique envoyé tel quel à la base — le LLM n'intervient jamais sur un prix
 * (principe 3).
 *
 * Limites connues (étape 2 : compréhension par petit modèle) :
 *  - « montre » (le produit) est avalé par le verbe « montre-moi » ;
 *  - pas de synonymes (« basket » / « sneakers ») ni de fautes graves ici :
 *    les fautes légères sont couvertes côté SQL (trigrammes), le reste
 *    viendra avec les embeddings.
 */

export type PriceIntent = "around" | "max" | "min" | "between";

export interface ParsedProductQuery {
  /** Mots significatifs (singulier, sans mots vides ni montants). */
  terms: string[];
  minPrice: number | null;
  maxPrice: number | null;
  /** Montant cité par le client (tri par proximité et message « rien à ce prix »). */
  budget: number | null;
  priceIntent: PriceIntent | null;
}

/** « Autour de X » = X ± 20 %. Choix produit à valider avec Marc-well. */
export const AROUND_TOLERANCE = 0.2;
export const MAX_QUERY_TERMS = 5;

const MIN_PLAUSIBLE_AMOUNT = 500;
const MAX_PLAUSIBLE_AMOUNT = 100_000_000;

/** Mots de budget ou de description générique (taille, couleur…) qui ne désignent jamais un article. */
const GENERIC_WORDS = new Set(
  "autour entre environ budget moins maximum maxi minimum inferieur superieur dessous dessus alentours approximativement fcfa cfa xaf francs franc mille milles pres vers sous jusqu partir tarif taille pointure couleur modele".split(" "),
);

const AMOUNT_RE = /(?<![\w.,])(\d{1,3}(?:[ .,]\d{3})+|\d+)(?:\s?(k|mille|milles)\b)?(?:\s?(fcfa|cfa|xaf|francs?|f)\b)?/g;
// Pas de « max » / « min » nus : « Air Max 25000 » est un modèle de chaussure, pas un plafond.
const MAX_CUE_RE = /(?:^|\s)(moins de|moins que|maximum|jusqu a|jusqu au|pas plus de|pas plus que|en dessous de|sous|inferieur a|budget(?: maximum)?(?: de)?|<)\s*(?:de |d )?$/;
const MIN_CUE_RE = /(?:^|\s)(plus de|plus que|a partir de|minimum|au moins|au dessus de|superieur a|>)\s*$/;
const RANGE_JOIN_RE = /^\s*(et|a|jusqu a|jusqu au|-|to)\s*$/;

interface AmountMatch {
  value: number;
  start: number;
  end: number;
}

function prepare(message: string): string {
  return message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u00a0\u202f\u2009]/g, " ");
}

function findAmounts(text: string): AmountMatch[] {
  const found: AmountMatch[] = [];
  for (const match of text.matchAll(AMOUNT_RE)) {
    const digits = (match[1] ?? "").replace(/[ .,]/g, "");
    let value = Number(digits);
    if (!Number.isFinite(value)) continue;
    const hasMultiplier = Boolean(match[2]);
    const hasCurrency = Boolean(match[3]);
    if (hasMultiplier) value *= 1000;
    else if (!hasCurrency) {
      // Sans « k » ni devise : « taille 42 », « 2 chemises », « 2026 » ne sont pas des prix.
      if (value < MIN_PLAUSIBLE_AMOUNT) continue;
      if (value >= 1900 && value <= 2100) continue;
    }
    if (value < 100 || value > MAX_PLAUSIBLE_AMOUNT) continue;
    found.push({ value, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return found;
}

function roundTo100(n: number): number {
  return Math.round(n / 100) * 100;
}

export function parseProductQuery(message: string): ParsedProductQuery {
  const text = prepare(message);
  const amounts = findAmounts(text);

  let minPrice: number | null = null;
  let maxPrice: number | null = null;
  let budget: number | null = null;
  let priceIntent: PriceIntent | null = null;
  const used: AmountMatch[] = [];

  const first = amounts[0];
  const second = amounts[1];
  if (first && second && RANGE_JOIN_RE.test(text.slice(first.end, second.start))) {
    const [a, b] = [first.value, second.value];
    minPrice = Math.min(a, b);
    maxPrice = Math.max(a, b);
    budget = Math.round((minPrice + maxPrice) / 2);
    priceIntent = "between";
    used.push(first, second);
  } else if (first) {
    // Le premier montant plausible porte l'intention ; un second montant isolé est ignoré.
    const amount = first;
    const before = text.slice(Math.max(0, amount.start - 30), amount.start).trimEnd();
    if (MAX_CUE_RE.test(before)) {
      maxPrice = amount.value;
      budget = amount.value;
      priceIntent = "max";
    } else if (MIN_CUE_RE.test(before)) {
      minPrice = amount.value;
      budget = amount.value;
      priceIntent = "min";
    } else {
      minPrice = roundTo100(amount.value * (1 - AROUND_TOLERANCE));
      maxPrice = roundTo100(amount.value * (1 + AROUND_TOLERANCE));
      budget = amount.value;
      priceIntent = "around";
    }
    used.push(amount);
  }

  // Retire les montants du texte avant d'extraire les mots (sinon « 25000 » serait un mot-clé).
  let cleaned = text;
  for (const amount of [...used].sort((x, y) => y.start - x.start)) {
    cleaned = `${cleaned.slice(0, amount.start)} ${cleaned.slice(amount.end)}`;
  }
  const terms = extractSearchTerms(cleaned, 12, 3)
    .filter((term) => !GENERIC_WORDS.has(term))
    .slice(0, MAX_QUERY_TERMS);

  return { terms, minPrice, maxPrice, budget, priceIntent };
}

export function hasPriceFilter(query: Pick<ParsedProductQuery, "minPrice" | "maxPrice">): boolean {
  return query.minPrice !== null || query.maxPrice !== null;
}

const CATEGORY_LIST_NOUNS = new Set(["categorie", "rayon", "rubrique"]);

/** « Quelles catégories avez-vous ? » — demande la liste des catégories (parcours par catégorie). */
export function detectCategoryListRequest(message: string): boolean {
  const tokens = tokenize(message);
  if (tokens.length === 0 || tokens.length > 8) return false;
  return tokens.some((token) => CATEGORY_LIST_NOUNS.has(singularize(token)));
}
