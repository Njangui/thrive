import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { reconcileStalePayments } from "@/application/services/subscription-payment-service";

/**
 * Repasse fiabilité P0 (07/09/2026, section 62 de la mission : "prévoir
 * un job de reconciliation... ne jamais dépendre exclusivement du
 * navigateur ou d'un seul webhook"). Même pattern exact que les autres
 * routes cron (`process-subscription-renewals`, `process-broadcasts`) :
 * protection par CRON_SECRET (`verifyCronAuth`, fail-safe en production),
 * réponse toujours JSON, fonction métier pure appelée depuis un cron
 * externe.
 *
 * Fréquence recommandée : toutes les 15-30 minutes (voir
 * docs/DEPLOYMENT.md) — assez souvent pour rattraper un webhook jamais
 * livré sans attendre trop longtemps, sans spammer l'API du provider pour
 * des paiements encore légitimement en cours.
 */
async function handle(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  try {
    const result = await reconcileStalePayments();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/cron/process-payment-reconciliation: échec:", error);
    return NextResponse.json({ ok: false, error: "Erreur interne" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
