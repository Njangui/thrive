import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskAdminRepository, TaskRecord } from "@/application/agents/task-service";
import { TASK_AGENT } from "@/application/agents/task-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

type Row = Record<string, unknown>;
const COLS = "id, title, instruction, schedule_kind, interval_seconds, next_run_at, enabled, last_run_at, last_status, created_by";
const toRecord = (r: Row): TaskRecord => ({
  id: String(r.id), title: (r.title as string | null) ?? null, instruction: String(r.instruction), kind: r.schedule_kind === "interval" ? "interval" : "once",
  intervalSeconds: (r.interval_seconds as number | null) ?? null, nextRunAt: String(r.next_run_at), enabled: Boolean(r.enabled),
  lastRunAt: (r.last_run_at as string | null) ?? null, lastStatus: (r.last_status as string | null) ?? null, createdBy: String(r.created_by),
});

/** Service-role : CHAQUE requête est filtrée par organisation. */
export function createSupabaseTaskRepository(db: SupabaseClient = getSupabaseServiceClient()): TaskAdminRepository {
  return {
    async list(tenantId) {
      const { data, error } = await db.from("scheduled_tasks").select(COLS).eq("organization_id", tenantId).order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error(`scheduled_tasks: lecture impossible (${error.message})`);
      return (data ?? []).map((r) => toRecord(r as Row));
    },
    async get(tenantId, id) {
      const { data, error } = await db.from("scheduled_tasks").select(COLS).eq("organization_id", tenantId).eq("id", id).maybeSingle();
      if (error) throw new Error(`scheduled_tasks: lecture impossible (${error.message})`);
      return data ? toRecord(data as Row) : null;
    },
    async countActive(tenantId) {
      const { count, error } = await db.from("scheduled_tasks").select("id", { count: "exact", head: true }).eq("organization_id", tenantId).eq("enabled", true);
      if (error) throw new Error(`scheduled_tasks: comptage impossible (${error.message})`);
      return count ?? 0;
    },
    async insert(row) {
      const { data, error } = await db.from("scheduled_tasks").insert({
        organization_id: row.tenantId, created_by: row.createdBy, agent_name: TASK_AGENT, title: row.title, instruction: row.instruction,
        schedule_kind: row.kind, interval_seconds: row.intervalSeconds, next_run_at: row.nextRunAt, enabled: true,
      }).select("id").single();
      if (error || !data) throw new Error(`scheduled_tasks: création impossible (${error?.message ?? "inconnue"})`);
      return { id: String(data.id) };
    },
    async setEnabled(tenantId, id, enabled, nextRunAt) {
      const patch: Row = { enabled, ...(enabled ? { consecutive_failures: 0, locked_until: null } : {}), ...(nextRunAt ? { next_run_at: nextRunAt } : {}) };
      const { data, error } = await db.from("scheduled_tasks").update(patch).eq("organization_id", tenantId).eq("id", id).select("id").maybeSingle();
      if (error) throw new Error(`scheduled_tasks: mise à jour impossible (${error.message})`);
      return Boolean(data);
    },
    async remove(tenantId, id) {
      const { data, error } = await db.from("scheduled_tasks").delete().eq("organization_id", tenantId).eq("id", id).select("id").maybeSingle();
      if (error) throw new Error(`scheduled_tasks: suppression impossible (${error.message})`);
      return Boolean(data);
    },
  };
}
