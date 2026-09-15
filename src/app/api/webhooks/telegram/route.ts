import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { hashPayload, parseTelegramUpdate, verifyTelegramSecretToken } from "@/infrastructure/providers/telegram/webhook-handler";
import { handlePlatformBotMessage } from "@/application/services/telegram-bot-service";

/**
 * Webhook du bot Telegram PLATEFORME (alertes admin + commandes
 * affiliés — /start, /mystats). ENTIÈREMENT séparé du webhook Telegram
 * "canal client" (app/api/webhooks/telegram/tenant/[token]/route.ts) :
 * URL fixe (un seul bot plateforme, pas un par tenant), secret fixe
 * (`TELEGRAM_BOT_WEBHOOK_SECRET`), déduplication sous
 * `provider='telegram_platform'` (jamais `telegram_tenant`) — voir
 * docs/TELEGRAM_INTEGRATION.md pour le tableau récapitulatif des deux
 * intégrations Telegram de ce projet.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const headerValue = request.headers.get("x-telegram-bot-api-secret-token");

  if (!verifyTelegramSecretToken(headerValue, env.TELEGRAM_BOT_WEBHOOK_SECRET ?? "")) {
    console.warn("Telegram platform webhook: secret invalide, rejeté.");
    return NextResponse.json({ error: "invalid secret" }, { status: 401 });
  }

  const update = parseTelegramUpdate(rawBody);
  const externalEventId = String(update.update_id); // unique pour CE bot (un seul bot plateforme, pas de collision possible).

  const supabase = getSupabaseServiceClient();
  const { error: insertEventError } = await supabase.from("webhook_events").insert({
    organization_id: null, // événement plateforme, non scopé à un tenant.
    provider: "telegram_platform",
    external_event_id: externalEventId,
    event_type: update.message ? "message" : update.callback_query ? "callback_query" : "unknown",
    payload_hash: hashPayload(rawBody),
    status: "received",
  });

  if (insertEventError) {
    if (insertEventError.code === "23505") {
      console.info(`Telegram platform webhook: update dupliqué ignoré (${externalEventId})`);
      return NextResponse.json({ ok: true });
    }
    console.error("Telegram platform webhook: échec insertion webhook_events:", insertEventError.message);
    return NextResponse.json({ ok: true });
  }

  try {
    if (update.message) {
      await handlePlatformBotMessage(update.message);
    }
    await markWebhookEvent(externalEventId, "processed");
  } catch (processingError) {
    console.error("Telegram platform webhook: échec traitement:", processingError);
    await markWebhookEvent(
      externalEventId,
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
    .eq("provider", "telegram_platform")
    .eq("external_event_id", externalEventId);
}
