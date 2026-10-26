import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { replayFailedPaymentWebhookEvents } from "@/infrastructure/providers/payment/webhook-pipeline";

/**
 * Décision Q20 : rejoue les événements de paiement `failed` (3 essais au total), puis alerte Telegram
 * et passe l'événement en `dead`. Fréquence recommandée : toutes les 10-15 minutes
 * (voir docs/DEPLOYMENT.md). Protégée par CRON_SECRET comme toutes les routes cron.
 */
async function handle(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(auth.body, { status: auth.status });
  }
  try {
    const result = await replayFailedPaymentWebhookEvents("fapshi");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/cron/replay-webhook-events: échec:", error);
    return NextResponse.json({ ok: false, error: "Erreur interne" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
