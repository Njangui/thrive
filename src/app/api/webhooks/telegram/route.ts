import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { hashPayload, parseTelegramUpdate, verifyTelegramSecretToken } from "@/infrastructure/providers/telegram/webhook-handler";
import { handlePlatformBotMessage } from "@/application/services/telegram-bot-service";

/**
 * CORRECTIF (build V22) : ce fichier contenait par erreur une copie du
 * webhook TENANT (`api/webhooks/telegram/tenant/[token]/route.ts`) — sans
 * doute un reliquat de fusion, une lot ayant dupliqué le mauvais fichier au
 * mauvais chemin. `next build` le détectait : cette route (URL fixe, sans
 * segment dynamique) déclarait un second paramètre `{ params }: { params:
 * Promise<{ token: string }> }` qui n'a aucun sens ici — Next.js ne fournit
 * jamais de `token` sur un chemin sans `[token]`, donc `await params` valait
 * `{}` et `resolveOrganizationIdByTelegramWebhookToken(undefined)` échouait
 * silencieusement à chaque requête réelle du bot plateforme.
 *
 * Webhook du bot Telegram PLATEFORME (URL fixe, voir
 * docs/TELEGRAM_INTEGRATION.md) — alertes opérateur (candidature affilié,
 * fraude, demande de paiement) + commandes entrantes des affiliés (/start
 * <jeton> pour lier leur chat, /mystats, /help), voir
 * telegram-bot-service.ts::handlePlatformBotMessage. ENTIÈREMENT séparé du
 * canal client par tenant : bot différent (`TELEGRAM_BOT_TOKEN`,
 * configuration serveur, un seul pour toute la plateforme), jeton de webhook
 * différent (`TELEGRAM_BOT_WEBHOOK_SECRET`, fixe), aucun import croisé,
 * déduplication séparée (`provider = 'telegram_platform'` vs
 * `'telegram_tenant'`).
 *
 * Toujours répondre 200 (même sur update ignoré/dupliqué) pour éviter que
 * Telegram ne retente indéfiniment — même raisonnement que les deux autres
 * webhooks du projet (Zernio, Telegram tenant).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  // CONFIRMÉ (core.telegram.org/bots/api#setwebhook) : header
  // `X-Telegram-Bot-Api-Secret-Token`, comparaison directe (pas de HMAC) —
  // voir webhook-handler.ts.
  const headerValue = request.headers.get("x-telegram-bot-api-secret-token");

  if (!verifyTelegramSecretToken(headerValue, env.TELEGRAM_BOT_WEBHOOK_SECRET ?? "")) {
    console.warn("Telegram bot plateforme webhook: secret invalide, rejeté.");
    return NextResponse.json({ error: "invalid secret" }, { status: 401 });
  }

  const update = parseTelegramUpdate(rawBody);
  // Un seul bot pour toute la plateforme (contrairement au canal tenant, où
  // plusieurs bots coexistent) : `update_id` seul suffit comme clé
  // d'idempotence, CONFIRMÉ strictement croissant par bot (voir types.ts).
  const externalEventId = String(update.update_id);

  const supabase = getSupabaseServiceClient();
  const { error: insertEventError } = await supabase.from("webhook_events").insert({
    provider: "telegram_platform",
    external_event_id: externalEventId,
    event_type: "message",
    payload_hash: hashPayload(rawBody),
    status: "received",
  });

  if (insertEventError) {
    // Violation de la contrainte unique (provider, external_event_id) =
    // update déjà vu -> on l'ignore silencieusement.
    if (insertEventError.code === "23505") {
      console.info(`Telegram bot plateforme webhook: update dupliqué ignoré (${externalEventId})`);
      return NextResponse.json({ ok: true });
    }
    console.error("Telegram bot plateforme webhook: échec insertion webhook_events:", insertEventError.message);
    return NextResponse.json({ ok: true });
  }

  try {
    if (update.message) {
      await handlePlatformBotMessage(update.message);
    }
    await markWebhookEvent(externalEventId, "processed");
  } catch (processingError) {
    console.error("Telegram bot plateforme webhook: échec traitement:", processingError);
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
