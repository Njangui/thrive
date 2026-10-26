import { normalizeMessage } from "./message-intents";

/**
 * C3 — profil de voix de marque (livrable E). Code pur, sans I/O.
 *
 * Le profil décrit COMMENT l'assistant parle (tutoiement / vouvoiement, emojis,
 * expressions locales, expressions à éviter, exemples de messages) ; il ne dit
 * jamais CE QU'IL peut affirmer (prix, stock : toujours la base, principe 3).
 *
 * Il agit à deux endroits :
 *  - dans le prompt de rédaction (`formatVoiceForPrompt`) ;
 *  - dans le contrôle qualité (`checkVoiceCompliance`) : le modèle suit le profil
 *    ou sa réponse est écartée.
 */

export type Register = "vous" | "tu";
export type EmojiLevel = "none" | "light" | "rich";

export interface BrandVoice {
  register: Register;
  emojiLevel: EmojiLevel;
  localExpressions: string[];
  avoidExpressions: string[];
  /** Vrais messages du commerçant (≤ 10, redigés par lui, personnels retirés). Uniquement avec consentement. */
  exampleMessages: string[];
  examplesConsent: boolean;
}

/** Voix appliquée tant que le commerçant n'a rien configuré : identique au comportement historique. */
export const DEFAULT_BRAND_VOICE: BrandVoice = {
  register: "vous",
  emojiLevel: "light",
  localExpressions: [],
  avoidExpressions: [],
  exampleMessages: [],
  examplesConsent: false,
};

export const MAX_LOCAL_EXPRESSIONS = 10;
export const MAX_AVOID_EXPRESSIONS = 20;
export const MAX_EXAMPLE_MESSAGES = 10;
export const MAX_EXPRESSION_LENGTH = 40;
export const MAX_EXAMPLE_LENGTH = 300;

const EMOJI_CAPS: Record<EmojiLevel, number> = { none: 0, light: 2, rich: 6 };
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function countEmojis(text: string): number {
  return (text.match(EMOJI_RE) ?? []).length;
}

export function emojiCap(level: EmojiLevel): number {
  return EMOJI_CAPS[level];
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /\+?\d[\d ().\-]{6,}\d/g;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

/**
 * Retire d'un exemple de message ce qui identifie quelqu'un (email, numéro,
 * lien) : les exemples partent au fournisseur IA, on n'y envoie jamais de
 * donnée personnelle de client (minimisation).
 */
export function redactPersonalData(text: string): string {
  return text.replace(EMAIL_RE, "[email]").replace(URL_RE, "[lien]").replace(PHONE_RE, "[numéro]").replace(/\s+/g, " ").trim();
}

export type ParseResult = { ok: true; voice: BrandVoice } | { ok: false; errors: string[] };

function cleanList(value: unknown, max: number, maxLength: number, label: string, errors: string[]): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label} : liste attendue`);
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      errors.push(`${label} : texte attendu`);
      continue;
    }
    const trimmed = item.replace(/\s+/g, " ").trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > maxLength) {
      errors.push(`${label} : « ${trimmed.slice(0, 20)}… » dépasse ${maxLength} caractères`);
      continue;
    }
    if (!out.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) out.push(trimmed);
  }
  if (out.length > max) errors.push(`${label} : ${max} maximum`);
  return out.slice(0, max);
}

/** Valide une saisie du commerçant (formulaire ou outil de chat) ; refuse au lieu de deviner. */
export function parseBrandVoiceInput(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["profil attendu sous forme d'objet"] };
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];

  const register = o.register ?? DEFAULT_BRAND_VOICE.register;
  if (register !== "vous" && register !== "tu") errors.push("register : « vous » ou « tu »");
  const emojiLevel = o.emojiLevel ?? DEFAULT_BRAND_VOICE.emojiLevel;
  if (emojiLevel !== "none" && emojiLevel !== "light" && emojiLevel !== "rich") errors.push("emojiLevel : « none », « light » ou « rich »");

  const localExpressions = cleanList(o.localExpressions, MAX_LOCAL_EXPRESSIONS, MAX_EXPRESSION_LENGTH, "expressions locales", errors);
  const avoidExpressions = cleanList(o.avoidExpressions, MAX_AVOID_EXPRESSIONS, MAX_EXPRESSION_LENGTH, "expressions à éviter", errors);
  const exampleMessages = cleanList(o.exampleMessages, MAX_EXAMPLE_MESSAGES, MAX_EXAMPLE_LENGTH, "exemples de messages", errors).map(redactPersonalData);
  const examplesConsent = o.examplesConsent === true;
  if (exampleMessages.length > 0 && !examplesConsent) {
    errors.push("exemples de messages : le consentement explicite est requis (ils sont transmis au fournisseur d'IA)");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    voice: { register: register as Register, emojiLevel: emojiLevel as EmojiLevel, localExpressions, avoidExpressions, exampleMessages, examplesConsent },
  };
}

/** Lecture tolérante d'une ligne en base : jamais d'exception, valeurs par défaut sinon. */
export function voiceFromRow(row: Record<string, unknown> | null | undefined): BrandVoice {
  if (!row) return DEFAULT_BRAND_VOICE;
  const consent = row.examples_consent === true;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    register: row.register === "tu" ? "tu" : "vous",
    emojiLevel: row.emoji_level === "none" || row.emoji_level === "rich" ? row.emoji_level : "light",
    localExpressions: list(row.local_expressions).slice(0, MAX_LOCAL_EXPRESSIONS),
    avoidExpressions: list(row.avoid_expressions).slice(0, MAX_AVOID_EXPRESSIONS),
    exampleMessages: consent ? list(row.example_messages).slice(0, MAX_EXAMPLE_MESSAGES) : [],
    examplesConsent: consent,
  };
}

/** Consignes de ton ajoutées au prompt de rédaction. Vide pour la voix par défaut non personnalisée. */
export function formatVoiceForPrompt(voice: BrandVoice): string {
  const lines: string[] = [];
  lines.push(voice.register === "tu" ? "Tutoie le client (« tu », « ton »), sans jamais utiliser « vous »." : "Vouvoie le client (« vous », « votre »), sans jamais utiliser « tu ».");
  lines.push(
    voice.emojiLevel === "none"
      ? "N'utilise aucun emoji."
      : voice.emojiLevel === "light"
        ? "Emojis : 2 au maximum par message."
        : "Emojis : volontiers, 6 au maximum par message.",
  );
  if (voice.localExpressions.length > 0) lines.push(`Expressions locales que tu peux utiliser avec parcimonie : ${voice.localExpressions.join(", ")}.`);
  if (voice.avoidExpressions.length > 0) lines.push(`Ne dis jamais : ${voice.avoidExpressions.join(", ")}.`);
  if (voice.exampleMessages.length > 0) {
    lines.push(
      "Exemples de messages écrits par le commerçant (imite le style ; ne copie pas ; ne reprends aucune information qu'ils contiennent) :",
      ...voice.exampleMessages.map((m) => `« ${m} »`),
    );
  }
  return lines.join("\n");
}

export type VoiceViolation = "register_mismatch" | "avoid_expression" | "emoji_excess";

const TU_WORDS = new Set(["tu", "toi", "tes", "ton", "ta", "te"]);
const VOUS_WORDS = new Set(["vous", "votre", "vos"]);

/** Le modèle suit le profil, ou sa réponse est écartée (appelé par checkReplyQuality). */
export function checkVoiceCompliance(reply: string, voice: BrandVoice): VoiceViolation[] {
  const violations: VoiceViolation[] = [];
  const normalized = normalizeMessage(reply);
  const tokens = normalized.split(" ").filter(Boolean);

  const forbidden = voice.register === "vous" ? TU_WORDS : VOUS_WORDS;
  if (tokens.some((t) => forbidden.has(t))) violations.push("register_mismatch");

  for (const expression of voice.avoidExpressions) {
    const n = normalizeMessage(expression);
    if (n.length >= 3 && ` ${normalized} `.includes(` ${n} `)) {
      violations.push("avoid_expression");
      break;
    }
  }

  if (countEmojis(reply) > emojiCap(voice.emojiLevel)) violations.push("emoji_excess");
  return violations;
}
