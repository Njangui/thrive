import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { processDueAlerts } from "@/application/services/alert-service";

/**
 * C2 étape 4 — relâche les alertes retenues (fin des heures calmes) et fait
 * monter l'échelle d'escalade des alertes non accusées. À appeler par un cron
 * externe toutes les minutes (le délai d'escalade minimal est 1 min) — voir
 * docs/agents/c2-notify-alertes.md. Idempotent : réclamation atomique par palier.
 */
async function handle(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) return NextResponse.json(auth.body, { status: auth.status });
  try {
    return NextResponse.json({ ok: true, ...(await processDueAlerts()) });
  } catch (error) {
    console.error("/api/cron/process-alerts: échec:", error);
    return NextResponse.json({ ok: false, error: "Erreur interne" }, { status: 500 });
  }
}

export async function POST(request: Request) { return handle(request); }
export async function GET(request: Request) { return handle(request); }
