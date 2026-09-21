import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { checkRateLimit } from "@/lib/rate-limit";
import { handlePaymentWebhook } from "@/application/services/subscription-payment-service";

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

  // Idempotence : `unique (provider, external_event_id)` — voir
  // 0006_webhooks_and_audit.sql. Un conflit (23505) signifie un doublon
  // de livraison déjà traité, ignoré silencieusement (réponse 200 quand
  // même : ne jamais donner au provider une raison de re-livrer en boucle).
  const { error: insertEventError } = await supabase.from("webhook_events").insert({
    organization_id: null,
    provider: config.providerName,
    external_event_id: event.externalEventId,
    event_type: event.eventType,
    payload_hash: hashPayload(rawBody),
    status: "received",
  });

  if (insertEventError) {
    if (insertEventError.code === "23505") {
      console.info(`${config.providerName} webhook: événement dupliqué ignoré (${event.externalEventId})`);
      return NextResponse.json({ ok: true });
    }
    console.error(`${config.providerName} webhook: échec insertion webhook_events:`, insertEventError.message);
    // Toujours 200 : un échec d'écriture de notre propre table d'audit ne
    // doit jamais déclencher de retries provider sur un paiement peut-être
    // déjà traité par ailleurs (reconcileStalePayments rattrapera le cas
    // échéant). Même principe que pour l'ancienne route NotchPay.
    return NextResponse.json({ ok: true });
  }

  try {
    await handlePaymentWebhook(event.providerReference);
    await markWebhookEvent(config.providerName, event.externalEventId, "processed");
  } catch (processingError) {
    console.error(`${config.providerName} webhook: échec traitement événement:`, processingError);
    await markWebhookEvent(
      config.providerName,
      event.externalEventId,
      "failed",
      processingError instanceof Error ? processingError.message : String(processingError),
    );
  }

  return NextResponse.json({ ok: true });
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
