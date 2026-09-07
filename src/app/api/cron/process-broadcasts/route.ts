import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { processScheduledBroadcasts } from "@/application/services/whatsapp-group-service";

/**
 * Lot F — traite les diffusions groupées WhatsApp programmées dont
 * `scheduled_at` est passée. Destiné à être appelé par un cron externe
 * (cron-job.org, Vercel Cron...) toutes les 5-15 minutes — voir
 * docs/DEPLOYMENT.md, section "Diffusions groupées WhatsApp".
 *
 * NB : aucun pattern `/api/cron/*` n'existait déjà dans ce projet malgré
 * ce que semblait supposer le cahier Lot F ("suivez le pattern déjà en
 * place pour les publications sociales programmées") — les publications
 * sociales programmées (Lot D/marketing-service.ts) délèguent leur
 * timing à Zernio lui-même (`POST /posts` avec `scheduledAt`), il n'y a
 * jamais eu de cron applicatif à imiter ici. Cette route et sa protection
 * par secret sont donc introduites par ce lot — voir RAPPORT_LOT_F.md.
 *
 * Lot 1 (audit sécurité) — la vérification du secret est désormais
 * partagée avec `process-subscription-renewals` via `checkCronAuth`
 * (une seule source de vérité, section 100/101), et refuse désormais
 * l'appel (fail-safe) plutôt que de continuer sans protection quand
 * `CRON_SECRET` est absent EN PRODUCTION — voir src/lib/cron-auth.ts.
 */
async function handle(request: Request) {
  const authError = checkCronAuth(request, "/api/cron/process-broadcasts");
  if (authError) return authError;

  try {
    const result = await processScheduledBroadcasts();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/cron/process-broadcasts: échec:", error);
    return NextResponse.json({ ok: false, error: "Erreur interne" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

// La plupart des services de cron HTTP externes utilisent GET par défaut
// — même logique, même protection, pour éviter d'imposer un choix de
// méthode HTTP particulier à l'outil de scheduling choisi.
export async function GET(request: Request) {
  return handle(request);
}
