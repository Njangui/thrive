import { NextResponse } from "next/server";
import { env } from "@/lib/env";
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
 */
async function handle(request: Request) {
  if (env.CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else {
    // Volontairement bruyant plutôt que silencieux (section 54 : échouer
    // fort) — mais ne bloque pas l'exécution pour ne pas casser un
    // environnement de démo/dev sans CRON_SECRET configuré.
    console.warn(
      "/api/cron/process-broadcasts appelé sans CRON_SECRET configuré — route non protégée. " +
        "Configurez CRON_SECRET avant la mise en production (voir docs/DEPLOYMENT.md).",
    );
  }

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
