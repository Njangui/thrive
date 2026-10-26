import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { checkRateLimit } from "@/lib/rate-limit";
import { handlePaymentWebhook } from "@/application/services/subscription-payment-service";
import { notifyPlatformAdminTelegram } from "@/application/services/telegram-admin-notification-service";

/**
 * Pipeline générique de webhook paiement.
 *
 * Objectif explicite (demande du 2026-09-20) : quand on change — ou on
 * ajoute — un PaymentProvider, la route webhook de ce nouveau provider ne
 * doit plus jamais réimplémenter rate limiting, idempotence
 * (webhook_events), ou la gestion d'erreurs générique. Chaque route
 * `src/app/api/webhooks/<provider>/route.ts` se réduit à fournir SA
 * vérification d'authenticité (signature HMAC, secret statique...) et
 * SON parsing de payload — tout le reste est ici, une seule fois. Voir
 * `src/app/api/webhooks/fapshi/route.ts` pour l'exemple d'utilisation, et
 * `docs/PAYMENT_INTEGRATION.md` (section "Ajouter un nouveau provider").
 *
 * Ce module ne connaît AUCUN provider par son nom — seulement l'objet
 * PaymentWebhookConfig qu'on lui passe. C'est lui qui appelle
 * `handlePaymentWebhook()`, qui elle-même ne connaît qu'une référence
 * provider (string), jamais une forme de payload spécifique à un SDK —
 * voir le commentaire en tête de `subscription-payment-service.ts`.
 */

export interface ParsedPaymentWebhookEvent {
  /** Identifiant unique de CET évènement, utilisé comme clé d'idempotence dans webhook_events (provider, external_event_id) — voir 0006_webhooks_and_audit.sql. */
  externalEventId: string;
  /** Valeur libre stockée dans webhook_events.event_type (ex: le statut brut renvoyé par le provider). Purement informatif/debug, jamais utilisé pour décider quoi que ce soit (voir handlePaymentWebhook : on revérifie TOUJOURS via l'API, jamais sur la seule foi du webhook). */
  eventType: string;
  /** Référence provider de la transaction concernée — doit correspondre à subscription_payments.provider_reference (mis à jour par les services applicatifs juste après provider.createPayment(), voir leurs commentaires). */
  providerReference: string;
}

export interface PaymentWebhookConfig {
  /** Nom du provider tel que stocké dans webhook_events.provider (ex: "fapshi") — DOIT correspondre à PaymentProvider.providerName de l'adapter actif. */
  providerName: string;
  /** Vérifie l'authenticité de la requête à partir du corps brut et des en-têtes. Reçoit `request` pour lire les en-têtes propres au provider (signature, secret...). */
  verify: (rawBody: string, request: Request) => boolean;
  /** Parse le corps déjà vérifié. Peut lever sur JSON invalide — capturé par le pipeline (réponse 400). */
  parse: (rawBody: string) => ParsedPaymentWebhookEvent;
}

export async function handlePaymentWebhookRequest(request: Request, config: PaymentWebhookConfig): Promise<NextResponse> {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
  const retryAfter = await checkRateLimit("webhook", clientIp);
  if (retryAfter !== null) {
    return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const rawBody = await request.text();

  if (!config.verify(rawBody, request)) {
    console.warn(`${config.providerName} webhook: authentification invalide, rejeté.`);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: ParsedPaymentWebhookEvent;
  try {
    event = config.parse(rawBody);
  } catch (parseError) {
    console.error(`${config.providerName} webhook: corps invalide:`, parseError);
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  // Idempotence : `unique (provider, external_event_id)` — voir 0006_webhooks_and_audit.sql.
  const { error: insertEventError } = await supabase.from("webhook_events").insert({
    organization_id: null,
    provider: config.providerName,
    external_event_id: event.externalEventId,
    event_type: event.eventType,
    payload_hash: hashPayload(rawBody),
    status: "received",
    attempts: 1,
    last_attempt_at: new Date().toISOString(),
  });

  if (insertEventError) {
    if (insertEventError.code === "23505") {
      // Doublon de livraison. Correctif d'audit Q16 : si la 1re tentative a ÉCHOUÉ, cette nouvelle livraison
      // doit la REJOUER (avant : ignorée comme doublon → paiement jamais pris en compte). Un événement déjà
      // traité (ou en cours) reste ignoré : aucun second effet.
      const replayed = await claimFailedEventForReplay(config.providerName, event.externalEventId, MAX_WEBHOOK_ATTEMPTS);
      if (!replayed) {
        console.info(`${config.providerName} webhook: événement dupliqué ignoré (${event.externalEventId})`);
        return NextResponse.json({ ok: true });
      }
      console.info(`${config.providerName} webhook: événement échoué rejoué (${event.externalEventId}, essai ${replayed.attempts})`);
    } else {
      console.error(`${config.providerName} webhook: échec insertion webhook_events:`, insertEventError.message);
      // Toujours 200 : un échec d'écriture de notre propre table d'audit ne doit jamais déclencher de retries
      // provider (reconcileStalePayments rattrapera le cas échéant).
      return NextResponse.json({ ok: true });
    }
  }

  await processPaymentEvent(config.providerName, event.externalEventId, event.providerReference);
  return NextResponse.json({ ok: true });
}

/** Essais maximum d'un événement (Q20) avant de le déclarer `dead` et d'alerter. */
export const MAX_WEBHOOK_ATTEMPTS = 3;

async function processPaymentEvent(providerName: string, externalEventId: string, providerReference: string): Promise<boolean> {
  try {
    await handlePaymentWebhook(providerReference);
    await markWebhookEvent(providerName, externalEventId, "processed");
    return true;
  } catch (processingError) {
    console.error(`${providerName} webhook: échec traitement événement:`, processingError);
    await markWebhookEvent(
      providerName,
      externalEventId,
      "failed",
      processingError instanceof Error ? processingError.message : String(processingError),
    );
    return false;
  }
}

/**
 * Réserve ATOMIQUEMENT un événement `failed` pour le rejouer (`failed → received`, attempts + 1).
 * Renvoie null si l'événement n'est pas `failed` (déjà traité, en cours, ou essais épuisés).
 */
async function claimFailedEventForReplay(
  providerName: string,
  externalEventId: string,
  maxAttempts: number,
): Promise<{ attempts: number } | null> {
  const supabase = getSupabaseServiceClient();
  const { data: existing } = await supabase
    .from("webhook_events")
    .select("status, attempts")
    .eq("provider", providerName)
    .eq("external_event_id", externalEventId)
    .maybeSingle();
  if (!existing || existing.status !== "failed" || existing.attempts >= maxAttempts) return null;

  const attempts = existing.attempts + 1;
  const { data: claimed } = await supabase
    .from("webhook_events")
    .update({ status: "received", attempts, last_attempt_at: new Date().toISOString() })
    .eq("provider", providerName)
    .eq("external_event_id", externalEventId)
    .eq("status", "failed") // un seul rejeu simultané gagne
    .select("external_event_id")
    .maybeSingle();
  return claimed ? { attempts } : null;
}

/**
 * Tâche planifiée (Q20) : rejoue les événements de paiement `failed` (3 essais au total), puis passe
 * en `dead` ceux qui ont épuisé leurs essais et alerte. `external_event_id` = référence provider
 * (vrai pour Fapshi : transId). Les paiements restent de toute façon rattrapables par la réconciliation.
 */
export async function replayFailedPaymentWebhookEvents(providerName: string): Promise<{ replayed: number; succeeded: number; dead: number }> {
  const supabase = getSupabaseServiceClient();
  const { data: failed, error } = await supabase
    .from("webhook_events")
    .select("external_event_id, attempts")
    .eq("provider", providerName)
    .eq("status", "failed")
    .order("received_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`replayFailedPaymentWebhookEvents: lecture webhook_events: ${error.message}`);

  const result = { replayed: 0, succeeded: 0, dead: 0 };
  for (const row of failed ?? []) {
    if (row.attempts >= MAX_WEBHOOK_ATTEMPTS) {
      const { data: killed } = await supabase
        .from("webhook_events")
        .update({ status: "dead", processed_at: new Date().toISOString() })
        .eq("provider", providerName)
        .eq("external_event_id", row.external_event_id)
        .eq("status", "failed")
        .select("external_event_id")
        .maybeSingle();
      if (killed) {
        result.dead += 1;
        await notifyPlatformAdminTelegram("WEBHOOK_EVENT_DEAD", {
          organizationId: null,
          entityType: "webhook_event",
          entityId: null,
          details: { fournisseur: providerName, reference: row.external_event_id, essais: row.attempts },
        }).catch(() => undefined);
      }
      continue;
    }
    const claimed = await claimFailedEventForReplay(providerName, row.external_event_id, MAX_WEBHOOK_ATTEMPTS);
    if (!claimed) continue;
    result.replayed += 1;
    if (await processPaymentEvent(providerName, row.external_event_id, row.external_event_id)) result.succeeded += 1;
  }
  return result;
}

async function markWebhookEvent(providerName: string, externalEventId: string, status: string, errorMessage?: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("webhook_events")
    .update({ status, processed_at: new Date().toISOString(), error_message: errorMessage ?? null })
    .eq("provider", providerName)
    .eq("external_event_id", externalEventId);
}

function hashPayload(rawBody: string): string {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}
