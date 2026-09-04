import crypto from "node:crypto";
import type { NotchPayWebhookEvent } from "./types";

/**
 * Vérifie la signature HMAC du webhook entrant.
 *
 * CONFIRMÉ (developer.notchpay.co/get-started/webhooks, consulté 31 août
 * 2026) : header `X-Notch-Signature`, hex HMAC-SHA256 du BODY BRUT (pas
 * du body reparsé), clé = secret webhook configuré côté dashboard
 * NotchPay (Settings > Webhooks — DISTINCT de NOTCHPAY_API_KEY, voir
 * .env.example NOTCHPAY_WEBHOOK_SECRET). Même construction que
 * verifyZernioSignature (comparaison en temps constant), le header
 * diffère seulement par son nom.
 */
export function verifyNotchPaySignature(
  rawBody: string,
  signatureHeader: string | null,
  signingSecret: string,
): boolean {
  if (!signatureHeader || !signingSecret) return false;

  const expected = crypto.createHmac("sha256", signingSecret).update(rawBody).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Un seul événement par delivery (confirmé par l'exemple de payload de
 * la doc — contrairement à Zernio, on ne normalise pas vers un tableau
 * ici faute de tout signe qu'un batch soit possible).
 */
export function parseNotchPayWebhookPayload(rawBody: string): NotchPayWebhookEvent {
  return JSON.parse(rawBody) as NotchPayWebhookEvent;
}

export function hashPayload(rawBody: string): string {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}
