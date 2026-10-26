import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { defaultProspectingDeps, runProspectingTick } from "@/application/services/prospecting-service";

/**
 * Prospection WhatsApp : un passage envoie, dans la limite du plafond quotidien et de la plage horaire, les premiers
 * messages et relances des campagnes VALIDÉES. À appeler toutes les 10 à 15 minutes (cron externe), comme les autres
 * routes /api/cron/*. Même protection par CRON_SECRET.
 */
async function handle(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) return NextResponse.json(auth.body, { status: auth.status });
  try {
    return NextResponse.json({ ok: true, ...(await runProspectingTick(defaultProspectingDeps())) });
  } catch (error) {
    console.error("/api/cron/process-prospecting: échec:", error);
    return NextResponse.json({ ok: false, error: "Erreur interne" }, { status: 500 });
  }
}
export async function POST(request: Request) { return handle(request); }
export async function GET(request: Request) { return handle(request); }
