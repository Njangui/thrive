import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

export const dynamic = "force-dynamic";

/**
 * Endpoint de health-check pour un monitoring d'uptime externe
 * (UptimeRobot, Better Uptime, etc.) — absent jusqu'ici, voir
 * COMPARAISON_MASTER_PROMPT.md, section "Avant toute mise en production
 * réelle". Vérifie une connectivité DB réelle (pas juste "le process
 * tourne") : un `select` minimal, sans filtre sur `organization_id`
 * (aucune donnée sensible renvoyée, juste sa réussite/échec) — un
 * process up mais incapable de parler à Supabase doit déclencher une
 * alerte, pas un faux "OK".
 */
/** Audit S3 : résultat mis en cache 10 s — des appels en boucle ne multiplient pas les requêtes base. */
const CACHE_MS = 10_000;
let cached: { at: number; status: number; body: Record<string, string> } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.body, { status: cached.status });
  }
  const res = await check();
  cached = { at: Date.now(), status: res.status, body: res.body };
  return NextResponse.json(res.body, { status: res.status });
}

async function check(): Promise<{ status: number; body: Record<string, string> }> {
  try {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from("organizations").select("id", { count: "exact", head: true }).limit(1);

    if (error) {
      return { status: 503, body: { status: "error", database: "unreachable" } };
    }

    return { status: 200, body: { status: "ok", database: "reachable" } };
  } catch {
    return { status: 503, body: { status: "error" } };
  }
}
