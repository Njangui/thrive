import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import {
  hashPayload,
  parseNotchPayWebhookPayload,
  verifyNotchPaySignature,
} from "@/infrastructure/providers/payment/notchpay/webhook-handler";
import { handlePaymentWebhook } from "@/application/services/subscription-payment-service";

/**
 * Pipeline (même discipline que /api/webhooks/zernio/route.ts) :
 * External Webhook -> Signature Verification -> Parse -> Idempotence
 * (webhook_events) -> Application Service.
 *
 * Toujours répondre 200 rapidement, même sur événement ignoré/dupliqué,
 * pour éviter que NotchPay ne retente indéfiniment ("Best Practices" :
 * "Handle Retries — be prepared for Notch Pay to retry failed webhook
 * deliveries with exponential backoff").
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  // CONFIRMÉ (developer.notchpay.co/get-started/webhooks) : header `X-Notch-Signature`.
  const signature = request.headers.get("x-notch-signature");

  if (!verifyNotchPaySignature(rawBody, signature, env.NOTCHPAY_WEBHOOK_SECRET ?? "")) {
    console.warn("NotchPay webhook: signature invalide, rejeté.");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: ReturnType<typeof parseNotchPayWebhookPayload>;
  try {
    event = parseNotchPayWebhookPayload(rawBody);
  } catch (parseError) {
    console.error("NotchPay webhook: corps JSON invalide:", parseError);
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  // --- Idempotence (même table/pattern que le webhook Zernio) ---
  // organization_id encore inconnu à ce stade (résolu par
  // handlePaymentWebhook via subscription_payments.provider_reference) —
  // webhook_events.organization_id reste donc null ici, ce que la
  // colonne autorise (référence nullable, voir 0006_webhooks_and_audit.sql).
  const { error: insertEventError } = await supabase.from("webhook_events").insert({
    organization_id: null,
    provider: "notchpay",
    external_event_id: event.id,
    event_type: event.event,
    payload_hash: hashPayload(rawBody),
    status: "received",
  });

  if (insertEventError) {
    if (insertEventError.code === "23505") {
      console.info(`NotchPay webhook: événement dupliqué ignoré (${event.id})`);
      return NextResponse.json({ ok: true });
    }
    console.error("NotchPay webhook: échec insertion webhook_events:", insertEventError.message);
    return NextResponse.json({ ok: true }); // on ne fait jamais retenter NotchPay pour une erreur de notre côté
  }

  try {
    await handlePaymentWebhook(event);
    await markWebhookEvent(event.id, "processed");
  } catch (processingError) {
    console.error("NotchPay webhook: échec traitement événement:", processingError);
    await markWebhookEvent(
      event.id,
      "failed",
      processingError instanceof Error ? processingError.message : String(processingError),
    );
  }

  return NextResponse.json({ ok: true });
}

async function markWebhookEvent(externalEventId: string, status: string, errorMessage?: string) {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("webhook_events")
    .update({ status, processed_at: new Date().toISOString(), error_message: errorMessage })
    .eq("provider", "notchpay")
    .eq("external_event_id", externalEventId);
}
