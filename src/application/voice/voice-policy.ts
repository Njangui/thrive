/**
 * Règles PURES des commandes vocales (aucune E/S). Tout ce qui est décidable sans IA l'est ici :
 * « règles d'abord, IA ensuite ».
 */
import type { TranscribeRequest } from "@/domain/ports/speech-port";

/** Durée maximale d'un vocal accepté (alignée sur le micro du dashboard). Borne technique, pas un prix. */
export const MAX_VOICE_SECONDS = 120;
/** Taille maximale (alignée sur les pièces jointes du chat). */
export const MAX_VOICE_BYTES = 4 * 1024 * 1024;
/** Longueur maximale d'une transcription transmise à l'agent (= limite d'un message texte). */
export const MAX_TRANSCRIPT_CHARS = 4000;

type Mime = TranscribeRequest["mimeType"];

const starts = (b: Uint8Array, sig: number[], at = 0) => b.byteLength >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** Déduit le format audio de la SIGNATURE binaire. `null` = format non pris en charge. */
export function sniffAudioMime(bytes: Uint8Array): Mime | null {
  if (starts(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg";
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm";
  if (starts(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return "audio/mp4";
  if (starts(bytes, [0x49, 0x44, 0x33]) || (bytes.byteLength > 1 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return "audio/mpeg";
  return null;
}

export type AudioRejection = "too_large" | "too_long" | "bad_format" | "empty_audio";

/** Contrôles avant tout envoi à un fournisseur externe (coût + surface d'attaque). */
export function checkAudio(input: { bytes: Uint8Array; durationSec?: number }): { ok: true; mimeType: Mime } | { ok: false; reason: AudioRejection } {
  if (input.bytes.byteLength === 0) return { ok: false, reason: "empty_audio" };
  if (input.bytes.byteLength > MAX_VOICE_BYTES) return { ok: false, reason: "too_large" };
  if (input.durationSec !== undefined && input.durationSec > MAX_VOICE_SECONDS) return { ok: false, reason: "too_long" };
  const mimeType = sniffAudioMime(input.bytes);
  return mimeType ? { ok: true, mimeType } : { ok: false, reason: "bad_format" };
}

/** Nettoie une transcription : caractères de contrôle, espaces multiples, longueur. */
export function normalizeTranscript(raw: string): string {
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TRANSCRIPT_CHARS);
}

/**
 * Une transcription qui ressemble à un code (PIN dicté) n'est JAMAIS transmise à l'agent ni
 * enregistrée : suite de chiffres seule, ou « mon code/pin est … » suivi de chiffres.
 */
const DIGIT_WORDS = new Set(["zero", "zéro", "un", "une", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "oh", "one", "two", "three", "four", "five", "seven", "eight", "nine", "et", "and"]);

export function looksLikeDictatedSecret(text: string): boolean {
  // Chiffres dits à voix haute (« un deux trois… ») ou mélange chiffres/mots-chiffres, sans autre mot.
  const tokens = text.toLowerCase().split(/[\s.,;:\-–—_/]+/).filter(Boolean);
  const numericTokens = tokens.filter((t) => t !== "et" && t !== "and");
  if (numericTokens.length >= 4 && tokens.every((t) => /^\d+$/.test(t) || DIGIT_WORDS.has(t))) return true;
  const digits = text.replace(/\D/g, "");
  if (digits.length < 4) return false;
  const withoutSeparators = text.replace(/[\s.,;:\-–—_/]/g, "");
  if (/^\d+$/.test(withoutSeparators)) return true;
  return /\b(pin|code|mot de passe|password|secret)\b/i.test(text) && digits.length >= 4 && digits.length <= 12;
}

const MESSAGES: Record<AudioRejection | "unavailable" | "rate_limited" | "empty" | "secret_dictated" | "failed", string> = {
  too_large: "Ce vocal est trop volumineux. Envoyez-en un plus court (2 minutes maximum).",
  too_long: `Ce vocal est trop long (${MAX_VOICE_SECONDS / 60} minutes maximum). Envoyez-en un plus court.`,
  bad_format: "Je ne reconnais pas ce format audio. Envoyez un message vocal ou écrivez votre demande.",
  empty_audio: "Ce vocal est vide. Réessayez.",
  unavailable: "La transcription des vocaux n'est pas disponible pour le moment. Écrivez votre demande.",
  rate_limited: "Trop de vocaux d'affilée. Patientez une minute avant d'en envoyer un autre.",
  empty: "Je n'ai rien compris à ce vocal. Réessayez plus près du micro, ou écrivez votre demande.",
  secret_dictated: "⚠️ Ne dictez jamais votre code PIN : je ne traite pas ce vocal. Les validations se font depuis les boutons ou le tableau de bord.",
  failed: "Je n'ai pas pu traiter ce vocal. Réessayez ou écrivez votre demande.",
};
export const voiceMessage = (reason: keyof typeof MESSAGES): string => MESSAGES[reason];
