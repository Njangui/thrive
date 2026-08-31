import crypto from "node:crypto";
import type { ZernioInboxWebhookEvent } from "./types";

/**
 * Vérifie la signature HMAC du webhook entrant.
 *
 * CONFIRMÉ (docs.zernio.com/webhooks) : header `X-Zernio-Signature`
 * (alias legacy `X-Late-Signature`), hex HMAC-SHA256 du body brut, clé =
 * secret webhook configuré côté dashboard Zernio.
 */
export function verifyZernioSignature(
  rawBody: string,
  signatureHeader: string | null,
  signingSecret: string,
): boolean {
  if (!signatureHeader || !signingSecret) return false;

  const expected = crypto.createHmac("sha256", signingSecret).update(rawBody).digest("hex");

  // Comparaison en temps constant (amélioration par rapport à l'exemple
  // de la doc officielle, qui compare avec !==) pour éviter les attaques
  // par timing.
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function parseZernioWebhookPayload(rawBody: string): ZernioInboxWebhookEvent[] {
  const parsed = JSON.parse(rawBody);
  // Un seul événement par delivery d'après la doc (pas de batch confirmé) —
  // on normalise quand même vers un tableau pour rester robuste si ça
  // change, et pour garder l'appelant simple.
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function hashPayload(rawBody: string): string {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}
