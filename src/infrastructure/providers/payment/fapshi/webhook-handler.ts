import crypto from "node:crypto";
import type { FapshiWebhookEvent } from "./types";

/**
 * Vérifie l'en-tête `x-wh-secret`. CONFIRMÉ (docs.fapshi.com/en/api-
 * reference/endpoint/webhook) : contrairement à NotchPay (signature HMAC
 * calculée sur le corps brut), Fapshi envoie un simple secret partagé TEL
 * QUEL dans cet en-tête — comparaison directe en temps constant contre le
 * secret configuré côté dashboard Fapshi (celui-ci ne peut être relu
 * qu'une fois, à la création — voir docs/PAYMENT_INTEGRATION.md).
 *
 * `crypto.timingSafeEqual` exige deux buffers de même longueur : on
 * compare donc les longueurs d'abord (un secret invalide de longueur
 * différente ne doit jamais lever, juste échouer la vérification).
 */
export function verifyFapshiWebhookSecret(secretHeader: string | null, configuredSecret: string): boolean {
  if (!secretHeader || !configuredSecret) return false;
  const received = Buffer.from(secretHeader);
  const expected = Buffer.from(configuredSecret);
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(received, expected);
}

/**
 * Le corps du webhook Fapshi EST directement l'objet Transaction (même
 * forme que GET /payment-status/:transId) — pas d'enveloppe {id, event,
 * data} comme NotchPay, pas de tableau/batch. JSON.parse peut lever sur
 * un corps invalide : laissé remonter tel quel, l'appelant (route.ts /
 * webhook-pipeline.ts) traite cette exception en 400.
 */
export function parseFapshiWebhookPayload(rawBody: string): FapshiWebhookEvent {
  return JSON.parse(rawBody) as FapshiWebhookEvent;
}
