import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { processSubscriptionRenewals } from "@/application/services/subscription-payment-service";

/**
 * Lot N, Partie 1 — traite les échéances d'abonnement (relance J-3 +
 * passage past_due). Même pattern exact que
 * `/api/cron/process-broadcasts` (Lot F) : protection par CRON_SECRET,
 * réponse toujours JSON, fonction métier pure appelée depuis un cron
 * externe (cron-job.org, Vercel Cron...) toutes les 1-4h — voir
 * docs/DEPLOYMENT.md.
 *
 * Lot 1 (audit sécurité) — protection partagée avec `process-broadcasts`
 * via `checkCronAuth` (une seule source de vérité, section 100/101) ;
 * refuse désormais l'appel (fail-safe) plutôt que de continuer sans
 * protection quand `CRON_SECRET` est absent EN PRODUCTION — voir
 * src/lib/cron-auth.ts.
 */
async function handle(request: Request) {
  const authError = checkCronAuth(request, "/api/cron/process-subscription-renewals");
  if (authError) return authError;

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
