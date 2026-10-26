import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { JournalRow } from "@/application/agents/settings-service";

/** Dernières lignes du journal d'audit des agents, TOUJOURS filtrées par entreprise (service-role). */
export async function listJournalRows(tenantId: string, limit = 60, db: SupabaseClient = getSupabaseServiceClient()): Promise<JournalRow[]> {
  const { data, error } = await db
    .from("agent_audit_events")
    .select("id, created_at, tool_name, event, decision, reason, channel, risk")
    .eq("organization_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw new Error(`agent_audit_events: lecture impossible (${error.message})`);
  return (data ?? []).map((r) => ({
    id: String(r.id), createdAt: String(r.created_at), tool: String(r.tool_name), event: String(r.event),
    decision: (r.decision as string | null) ?? null, reason: (r.reason as string | null) ?? null, channel: String(r.channel), risk: String(r.risk),
  }));
}
