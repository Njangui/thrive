import crypto from "node:crypto";
import type { TelegramUpdate } from "./types";

/**
 * CONFIRMÉ (core.telegram.org/bots/api#setwebhook, paramètre
 * `secret_token`) : Telegram ne signe PAS le corps du webhook par HMAC
 * (contrairement à Zernio/NotchPay) — il renvoie tel quel, à chaque
 * delivery, le jeton fourni lors de `setWebhook()` dans le header
 * `X-Telegram-Bot-Api-Secret-Token`. La vérification est donc une simple
 * comparaison en temps constant, pas un calcul HMAC — documenté ici pour
 * ne pas ressembler à un oubli si quelqu'un compare aux deux autres
 * webhook-handlers de ce projet.
 */
export function verifyTelegramSecretToken(headerValue: string | null, expectedSecret: string): boolean {
  if (!headerValue || !expectedSecret) return false;

  const a = Buffer.from(headerValue);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function parseTelegramUpdate(rawBody: string): TelegramUpdate {
  return JSON.parse(rawBody) as TelegramUpdate;
}

/** Même fonction (même algorithme) que les autres webhook-handlers du projet — dupliquée volontairement plutôt que partagée pour garder chaque provider indépendant et remplaçable isolément (voir docs/ARCHITECTURE.md). */
export function hashPayload(rawBody: string): string {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}
