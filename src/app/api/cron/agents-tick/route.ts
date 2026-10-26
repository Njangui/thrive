import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runAgentsTick } from "@/infrastructure/agents/agents-tick";

/**
 * Tick unique du noyau agentique (P4) : dispatcher d'événements, planificateur
 * d'agents, hygiène (runs bloqués, rétention). Même protection que les autres
 * crons (`verifyCronAuth`). Fréquence recommandée : toutes les 5 minutes.
 * Chaque étape est isolée : l'échec de l'une n'empêche pas les autres.
 */
async function handle(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) return NextResponse.json(auth.body, { status: auth.status });
  try {
    return NextResponse.json({ ok: true, ...(await runAgentsTick()) });
  } catch (error) {
    console.error("/api/cron/agents-tick: échec:", error instanceof Error ? error.message : "erreur");
    return NextResponse.json({ ok: false, error: "Erreur interne" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
