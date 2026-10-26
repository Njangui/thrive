import { checkVoiceCompliance, type BrandVoice } from "./brand-voice";
import { normalizeMessage } from "./message-intents";

/**
 * C3 — contrôle qualité d'une réponse rédigée par le modèle, AVANT envoi.
 * Code pur, sans I/O (principes 3 et 4 : le modèle rédige, le code vérifie).
 *
 * On ne « corrige » pas la réponse : si une règle est violée, l'appelant
 * l'écarte et envoie une réponse déterministe construite depuis la base, ou
 * « je vérifie » avec escalade. Les règles ciblent ce qui coûte cher à un
 * commerçant : un prix inventé, un stock inventé, un lien étranger, une fuite
 * des consignes, un numéro ou email qui n'est pas le sien.
 *
 * Réglage : strict par défaut (mieux vaut une réponse déterministe qu'un prix
 * faux). Les seuils sont à ajuster sur le jeu de conversations réelles (I).
 */

export type QualityViolation =
  | "empty"
  | "too_long"
  | "robotic"
  | "repeated_greeting"
  | "ungrounded_price"
  | "stock_claim"
  | "foreign_link"
  | "prompt_leak"
  | "ungrounded_contact"
  | "register_mismatch"
  | "avoid_expression"
  | "emoji_excess"
  | "medical_advice"
  | "admission_promise";

export interface ReplyFacts {
  /** Montants (FCFA) que la réponse a le droit de citer : prix de base, prix barré, budget du client. */
  allowedAmounts: number[];
  /** Origines (https://boutique.example) dont les liens sont autorisés. */
  allowedOrigins: string[];
  /** Numéros de téléphone du commerçant (chiffres ou format libre). */
  allowedPhones: string[];
  allowedEmails: string[];
  /** La conversation a déjà commencé : pas de nouvelle salutation. */
  alreadyGreeted: boolean;
  /** Extraits de nos propres consignes qui ne doivent jamais apparaître dans une réponse. */
  protectedMarkers: string[];
  /** Voix de marque du commerçant : le modèle la suit ou sa réponse est écartée. */
  voice?: BrandVoice;
  /** « Gratuit » est fondé : une zone de livraison est réellement gratuite (ou gratuite dès un seuil) en base. Montants toujours contrôlés. */
  allowFree?: boolean;
  /** Secteur du commerçant (`health`, `education`…) : active les garde-fous propres aux secteurs sensibles. */
  sector?: string;
}

export interface QualityOptions {
  maxLength?: number;
  maxLines?: number;
}

export const DEFAULT_MAX_REPLY_LENGTH = 700;
export const DEFAULT_MAX_REPLY_LINES = 12;

const ROBOTIC_PHRASES = [
  "en tant que modele de langage",
  "en tant que modele d ia",
  "language model",
  "je suis programme pour",
  "voici une reponse a votre question",
  "n hesitez pas a revenir vers moi pour toute question complementaire",
  "je reste a votre entiere disposition pour toute information complementaire",
  "cordialement",
];
const LEAK_PHRASES = ["system prompt", "prompt systeme", "mes instructions", "mes consignes", "customer message", "donnees non fiables"];
const FREE_CLAIM_RE = /\b(gratuit\w*|offert\w*|free)\b/;
const GREETING_START_RE = /^(bonjour|bonsoir|salut|hello|hi|coucou|bienvenue)\b/;

const AMOUNT_WITH_CURRENCY_RE = /(\d{1,3}(?:[ .,\u202f\u00a0]\d{3})+|\d+)\s?(k|mille)?\s?(fcfa|cfa|xaf|francs?|f)\b/gi;
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s)>\]]+)/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const STOCK_RES = [
  /\b\d+\s*(?:exemplaires?|unites?|pieces?|articles?)?\s*(?:restants?|en stock|disponibles?)\b/,
  /\bplus que\s*\d+\b/,
  /\bil (?:en )?reste\s*\d+/,
  /\bstock\b.{0,15}\d+/,
];

/** Santé : ni posologie, ni conseil de traitement, ni diagnostic affirmé. Le modèle n'est pas un soignant (voir SECTOR_AI_RULES). */
const MEDICAL_ADVICE_RES = [
  /\b\d+(?:[.,]\d+)?\s?(?:mg|g|ml|mcg|comprimes?|gelules?|gouttes?|cuilleres?|sachets?)\b/,
  /\b(?:prenez|prends|prendre|avalez|administrez)\b.{0,50}\b(?:paracetamol|ibuprofene|aspirine|antibiotiques?|amoxicilline|doliprane|medicaments?|comprimes?|sirop|traitement)\b/,
  /\b(?:vous avez|tu as|c est|il s agit d|vous souffrez d|vous etes atteint)\b.{0,25}\b(?:paludisme|palu|typhoide|cancer|diabete|hypertension|infection|grippe|covid|vih|sida|tuberculose|hepatite)\b/,
  /\b(?:un|une|deux|trois|quatre|cinq|six|dix)\s+(?:comprimes?|gelules?|gouttes?|cuilleres?|sachets?)\b/,
  /\b(?:mon|le) diagnostic\b/,
];
/** Éducation : aucune promesse d'admission, de diplôme ou de réussite. */
const ADMISSION_PROMISE_RES = [
  /\b(?:admission|inscription|diplome|reussite|emploi|equivalence)\b.{0,25}\b(?:garanti\w*|assure\w*|certain\w*)\b/,
  /\bvous serez (?:admis|accepte|diplome)\b/,
  /\b100 ?(?:pour ?cent)? ?(?:de )?(?:reussite|admission|insertion)\b/,
];
const ADMISSION_PERCENT_RE = /100\s?%\s?(?:de\s)?(?:réussite|reussite|admission|insertion)/i;

function prepare(text: string): string {
  return text.normalize("NFKC").replace(/[\u00a0\u202f\u2009]/g, " ");
}

function amountsIn(text: string): number[] {
  const values: number[] = [];
  for (const m of text.matchAll(AMOUNT_WITH_CURRENCY_RE)) {
    const base = Number((m[1] ?? "").replace(/[ .,\u202f\u00a0]/g, ""));
    if (Number.isFinite(base)) values.push(m[2] ? base * 1000 : base);
  }
  return values;
}

function hostOf(url: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const digitsOf = (s: string) => s.replace(/\D/g, "");

export function checkReplyQuality(reply: string, facts: ReplyFacts, options: QualityOptions = {}): { ok: boolean; violations: QualityViolation[] } {
  const violations = new Set<QualityViolation>();
  const text = prepare(reply).trim();
  if (text.length === 0) return { ok: false, violations: ["empty"] };

  const normalized = normalizeMessage(text);

  if (text.length > (options.maxLength ?? DEFAULT_MAX_REPLY_LENGTH) || text.split("\n").filter((l) => l.trim()).length > (options.maxLines ?? DEFAULT_MAX_REPLY_LINES)) {
    violations.add("too_long");
  }

  // Robotique : jargon, formules toutes faites, phrase répétée mot pour mot.
  if (ROBOTIC_PHRASES.some((p) => normalized.includes(p))) violations.add("robotic");
  const sentences = text.split(/[.!?\n]+/).map((s) => normalizeMessage(s)).filter((s) => s.length > 12);
  if (new Set(sentences).size < sentences.length) violations.add("robotic");

  if (facts.alreadyGreeted && GREETING_START_RE.test(normalized)) violations.add("repeated_greeting");

  // Prix : tout montant en FCFA cité doit venir de la base (ou du budget du client).
  const allowed = new Set(facts.allowedAmounts.map((a) => Math.round(a)));
  if (amountsIn(text).some((a) => !allowed.has(Math.round(a))) || (!facts.allowFree && FREE_CLAIM_RE.test(normalized))) {
    violations.add("ungrounded_price");
  }

  // Stock : aucune quantité (on ne fournit jamais le stock au modèle).
  if (STOCK_RES.some((re) => re.test(normalized))) violations.add("stock_claim");

  // Liens : uniquement ceux du site du commerçant.
  const allowedHosts = new Set(facts.allowedOrigins.map(hostOf).filter((h): h is string => Boolean(h)));
  for (const m of text.matchAll(URL_RE)) {
    const host = hostOf(m[1] ?? "");
    if (!host || !allowedHosts.has(host)) violations.add("foreign_link");
  }

  // Fuite des consignes.
  const markers = facts.protectedMarkers.map((m) => normalizeMessage(m)).filter((m) => m.length >= 8);
  if (LEAK_PHRASES.some((p) => normalized.includes(p)) || markers.some((m) => normalized.includes(m))) violations.add("prompt_leak");

  // Coordonnées : emails et numéros (≥ 8 chiffres) doivent être ceux du commerçant.
  const allowedEmails = new Set(facts.allowedEmails.map((e) => e.toLowerCase()));
  for (const m of text.match(EMAIL_RE) ?? []) if (!allowedEmails.has(m.toLowerCase())) violations.add("ungrounded_contact");
  const allowedPhoneTails = facts.allowedPhones.map((p) => digitsOf(p).slice(-8)).filter((d) => d.length === 8);
  const withoutAmounts = text.replace(AMOUNT_WITH_CURRENCY_RE, " ");
  for (const m of withoutAmounts.matchAll(/\+?\d[\d ().\-]{6,}\d/g)) {
    const digits = digitsOf(m[0]);
    if (digits.length >= 8 && !allowedPhoneTails.includes(digits.slice(-8))) violations.add("ungrounded_contact");
  }

  if (facts.sector === "health" && MEDICAL_ADVICE_RES.some((re) => re.test(normalized))) violations.add("medical_advice");
  if (facts.sector === "education" && (ADMISSION_PROMISE_RES.some((re) => re.test(normalized)) || ADMISSION_PERCENT_RE.test(text))) violations.add("admission_promise");

  // Voix de marque : registre (tu/vous), expressions à éviter, nombre d'emojis.
  if (facts.voice) for (const v of checkVoiceCompliance(text, facts.voice)) violations.add(v);

  return { ok: violations.size === 0, violations: [...violations] };
}
