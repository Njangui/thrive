import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { releaseExpiredAffiliateHolds } from "@/application/services/affiliate-service";

/**
 * Programme d'affiliation (0044) — fait passer les commissions
 * `pending_hold` dont `hold_release_at` est dépassée à `approved` (ou
 * `reversed` si le paiement source a entre-temps été remboursé/annulé).
 * À appeler quotidiennement (cron-job.org, Vercel Cron...) — voir
 * docs/AFFILIATE_SYSTEM.md, section "Tâches planifiées". Même protection
 * par secret que les autres routes /api/cron/*.
 */
async function handle(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  try {
    const result = await releaseExpiredAffiliateHolds();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/cron/release-affiliate-holds: échec:", error);
    return NextResponse.json({ ok: false, error: "Erreur interne" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
