import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { processSubscriptionRenewals } from "@/application/services/subscription-payment-service";

/**
 * Lot N, Partie 1 — traite les échéances d'abonnement (relance J-3 +
 * passage past_due). Même pattern exact que
 * `/api/cron/process-broadcasts` (Lot F) : protection par CRON_SECRET,
 * réponse toujours JSON, fonction métier pure appelée depuis un cron
 * externe (cron-job.org, Vercel Cron...) toutes les 1-4h — voir
 * docs/DEPLOYMENT.md.
 *
 * CORRECTIF Lot 3 (audit master prompt §65) : voir lib/cron-auth.ts pour
 * le fail-safe production désormais partagé par toutes les routes cron.
 */
async function handle(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  try {
    const result = await processSubscriptionRenewals();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/cron/process-subscription-renewals: échec:", error);
    return NextResponse.json({ ok: false, error: "Erreur interne" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
