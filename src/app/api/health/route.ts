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
export async function GET() {
  try {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from("organizations").select("id", { count: "exact", head: true }).limit(1);

    if (error) {
      return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
    }

    return NextResponse.json({ status: "ok", database: "reachable" }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
