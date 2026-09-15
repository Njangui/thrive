import crypto from "node:crypto";
import type { TelegramUpdate } from "./types";

/**
 * Même mécanique que `infrastructure/providers/telegram/webhook-handler.ts`
 * (bot plateforme) — secret_token comparé en temps constant, PAS un HMAC
 * (Telegram ne signe pas le corps, voir ce fichier pour la référence
 * officielle) — mais un secret DIFFÉRENT par connexion ici (un par
 * tenant, résolu via resolve-organization.ts), jamais le secret
 * plateforme `TELEGRAM_BOT_WEBHOOK_SECRET`.
 */
export function verifyTelegramTenantSecretToken(headerValue: string | null, expectedSecret: string): boolean {
  if (!headerValue || !expectedSecret) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function parseTelegramTenantUpdate(rawBody: string): TelegramUpdate {
  return JSON.parse(rawBody) as TelegramUpdate;
}

export function hashPayload(rawBody: string): string {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}
