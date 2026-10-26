import { redactPersonalData } from "./brand-voice";
import { wordsMatch } from "./faq-word-match";
import { singularize, tokenize } from "./message-intents";

/**
 * C3 — FAQ qui apprend (livrable F). Code pur, sans I/O.
 *
 * Boucle d'ingénierie, pas magie (principe 8) : on COMPTE les questions qui
 * reviennent, on PROPOSE une FAQ au propriétaire, il VALIDE, MODIFIE ou REFUSE.
 * Rien n'est publié automatiquement.
 *
 * Regroupement par mots (radicaux compatibles avec le moteur de FAQ), sans
 * embeddings : suffisant pour « vous livrez à Douala ? » ~ « livraison sur
 * Douala possible ? ». Les embeddings (étape 3) affineront le regroupement ;
 * l'interface (`areSimilar`, `clusterQuestions`) ne changera pas.
 */

export const FAQ_WINDOW_DAYS = 7;
export const DEFAULT_WEEKLY_THRESHOLD = 3;
export const MIN_WEEKLY_THRESHOLD = 2;
export const MAX_WEEKLY_THRESHOLD = 50;
/** Deux questions sont « la même » à partir de 50 % de mots en commun (rapporté à la plus longue) et au moins 2 mots partagés. */
export const SIMILARITY_THRESHOLD = 0.5;
export const MIN_SHARED_TOKENS = 2;
export const REVIEW_INTERVAL_DAYS = 90;
/** Une proposition refusée n'est pas re-proposée avant ce délai. */
export const REJECT_COOLDOWN_DAYS = 90;
/** Un tour d'IA consomme 1 crédit (voir assistant-turn-service) ; une FAQ servie n'en consomme aucun. */
export const CREDITS_PER_AI_TURN = 1;
export const MAX_LOGGED_QUESTION_LENGTH = 200;
export const MAX_SUGGESTED_ANSWER_LENGTH = 600;
const MAX_TOKENS = 8;

// Mots sans valeur de regroupement (politesse, interrogation, auxiliaires). Volontairement SANS
// « horaires », « adresse », « livraison »… : ce sont précisément les sujets de FAQ.
const STOP = new Set(
  "bonjour bonsoir salut merci svp stp please quel quelle quels quelles comment combien pouvez pourriez voulez avez avons etes est sont ete vous votre vos nous notre nos mon mes pour dans avec sans sur sous chez cette cet ces que qui quoi dont donc mais car aussi alors tout tous toute toutes bien tres plus moins peut puis est ils elles elle cela ceci celui celle ceux deux trois une des les aux par pas non oui".split(" "),
);

/** Mots significatifs d'une question (singulier, sans mots vides, uniques, triés). */
export function questionTokens(text: string): string[] {
  const out = new Set<string>();
  for (const raw of tokenize(text)) {
    // Mots vides testés AVANT et APRÈS le singulier (« vous » deviendrait « vou »).
    if (STOP.has(raw)) continue;
    const token = singularize(raw);
    if (token.length < 3 || STOP.has(token) || /^\d+$/.test(token)) continue;
    out.add(token);
  }
  return [...out].sort().slice(0, MAX_TOKENS);
}

/** Nombre de mots de `a` qui trouvent un correspondant (même radical) dans `b`. */
function sharedCount(a: string[], b: string[]): number {
  return a.filter((x) => b.some((y) => wordsMatch(x, y))).length;
}

export function similarity(a: string[], b: string[]): { shared: number; ratio: number } {
  const shared = Math.min(sharedCount(a, b), sharedCount(b, a));
  const longest = Math.max(a.length, b.length);
  return { shared, ratio: longest === 0 ? 0 : shared / longest };
}

/** Même question reformulée ? Deux mots en commun au moins (un seul si les deux questions n'en ont qu'un). */
export function areSimilar(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const { shared, ratio } = similarity(a, b);
  const needed = Math.min(MIN_SHARED_TOKENS, a.length, b.length);
  return shared >= needed && ratio >= SIMILARITY_THRESHOLD;
}

export interface LoggedQuestion {
  question: string;
  tokens: string[];
  resolution: "ai" | "verify";
  suggestedAnswer: string | null;
  createdAt: string;
}

export interface QuestionCluster {
  members: LoggedQuestion[];
  /** Mots présents dans au moins la moitié des questions du groupe. */
  signature: string[];
  /** Question la plus représentative (la plus proche des autres). */
  representative: LoggedQuestion;
}

function signatureOf(members: LoggedQuestion[]): string[] {
  const counts = new Map<string, number>();
  for (const m of members) for (const t of new Set(m.tokens)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const half = members.length / 2;
  return [...counts.entries()]
    .filter(([, n]) => n >= half)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([t]) => t)
    .sort();
}

/** Regroupement glouton « par chef de file » : stable et sans dépendance. */
export function clusterQuestions(questions: LoggedQuestion[]): QuestionCluster[] {
  const groups: LoggedQuestion[][] = [];
  const sorted = [...questions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const q of sorted) {
    const group = groups.find((g) => g[0] !== undefined && areSimilar(g[0].tokens, q.tokens));
    if (group) group.push(q);
    else groups.push([q]);
  }
  return groups.map((members) => {
    const representative = members.reduce<{ m: LoggedQuestion; score: number } | null>((best, m) => {
      const score = members.reduce((s, o) => s + similarity(m.tokens, o.tokens).ratio, 0);
      return !best || score > best.score ? { m, score } : best;
    }, null)?.m ?? (members[0] as LoggedQuestion); // groupe non vide par construction
    return { members, signature: signatureOf(members), representative };
  });
}

/** Le groupe de `tokens` dans `recent` : combien de fois cette question est revenue cette semaine. */
export function countSimilar(tokens: string[], recent: Array<Pick<LoggedQuestion, "tokens">>): number {
  return recent.filter((r) => areSimilar(tokens, r.tokens)).length;
}

export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WEEKLY_THRESHOLD;
  return Math.min(MAX_WEEKLY_THRESHOLD, Math.max(MIN_WEEKLY_THRESHOLD, Math.trunc(value)));
}

/** Question enregistrée pour le regroupement : données personnelles retirées, longueur bornée. */
export function redactQuestion(text: string): string {
  return redactPersonalData(text).slice(0, MAX_LOGGED_QUESTION_LENGTH);
}

/** Mot-clé proposé : les 3 mots les plus parlants ENSEMBLE (tous doivent apparaître : peu de faux déclenchements). */
export function suggestKeywords(signature: string[]): string[] {
  const words = signature.slice(0, 3);
  return words.length === 0 ? [] : [words.join(" ")];
}

// Variables dynamiques : voir faq-template.ts (module pur sans dépendance, partagé avec faq-resolver).
export { extractFaqVariables, checkFaqTemplate, renderFaqAnswer, FAQ_AMOUNT_RE, type FaqTemplateCheck } from "./faq-template";
import { FAQ_AMOUNT_RE } from "./faq-template";

// ---------------------------------------------------------------------------
// Réponse suggérée à partir d'une réponse déjà envoyée
// ---------------------------------------------------------------------------

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_RE = /\+?\d[\d ().\-]{6,}\d/;
const STOCK_RE = /\b(?:plus que|il reste|en stock)\b/i;

/**
 * Une réponse n'est proposée comme FAQ que si elle ne contient rien de périssable :
 * ni montant, ni numéro, ni email, ni lien (hors lien catalogue → variable), ni stock.
 * Sinon `null` : la proposition part SANS réponse et le propriétaire écrit la sienne.
 */
export function suggestAnswerFrom(reply: string, catalogUrl: string): string | null {
  const text = reply.trim();
  if (text.length < 15 || text.length > MAX_SUGGESTED_ANSWER_LENGTH) return null;
  if (FAQ_AMOUNT_RE.test(text) || EMAIL_RE.test(text) || PHONE_RE.test(text) || STOCK_RE.test(text)) return null;
  let foreignLink = false;
  const templated = text.replace(URL_RE, (url) => {
    if (url.replace(/\/$/, "") === catalogUrl.replace(/\/$/, "")) return "{catalog_url}";
    foreignLink = true;
    return url;
  });
  return foreignLink ? null : templated;
}

// ---------------------------------------------------------------------------
// Économies
// ---------------------------------------------------------------------------

export function creditsSaved(faqHits: number): number {
  return Math.max(0, Math.trunc(faqHits)) * CREDITS_PER_AI_TURN;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
