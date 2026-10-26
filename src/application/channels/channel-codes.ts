import { createHash, randomBytes } from "node:crypto";
import type { BackofficeChannel } from "./actor";

/**
 * Utilitaires PURS (sans E/S) pour les codes de liaison et la normalisation
 * des identifiants de canal. Testés dans channel-codes.test.ts.
 */

// Alphabet Crockford base32 sans I, L, O, U : pas d'ambiguïté à la saisie.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LINK_CODE_LENGTH = 10; // 10 × 5 bits = 50 bits d'entropie
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

export function generateLinkCode(): string {
  // 256 est un multiple de 32 : `byte % 32` est sans biais.
  const bytes = randomBytes(LINK_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % 32];
  return code;
}

/** Normalise une saisie utilisateur (`flx-ab12 cd34`, `O`→`0`, `I/L`→`1`) ; null si invalide. */
export function normalizeLinkCode(raw: string): string | null {
  const cleaned = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (cleaned.length !== LINK_CODE_LENGTH) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return cleaned;
}

/** SHA-256 hex : le code en clair n'est jamais stocké. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Normalise l'identifiant externe d'un canal.
 * - Telegram : identifiant utilisateur NUMÉRIQUE (jamais le @username, modifiable).
 * - WhatsApp : E.164 (`+` + 8 à 15 chiffres).
 * Renvoie null si invalide.
 */
export function normalizeExternalId(channel: BackofficeChannel, raw: string | number): string | null {
  const value = String(raw).trim();
  if (channel === "telegram") {
    return /^\d{1,20}$/.test(value) ? value : null;
  }
  const digits = value.replace(/[\s().-]/g, "").replace(/^\+/, "").replace(/^00/, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}
