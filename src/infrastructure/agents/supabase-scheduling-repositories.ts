/** Dépôts Supabase de P4 : outbox, planificateur, maintenance (fonctions SQL des migrations 0105/0106). */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MaintenanceRepository } from "@/application/agents/maintenance";
import type { ScheduledTaskRepository } from "@/application/agents/scheduler";
import type { OutboxRepository } from "@/application/events/outbox";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

type Row = Record<string, unknown>;

async function rpc(db: SupabaseClient, fn: string, args: Row): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}
const rows = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : []);

export function createSupabaseOutboxRepository(db: SupabaseClient = getSupabaseServiceClient()): OutboxRepository {
  return {
    async emit(i) {
      const r = rows(await rpc(db, "emit_domain_event", {
        p_organization_id: i.tenantId, p_type: i.type, p_payload: i.payload ?? {}, p_dedupe_key: i.dedupeKey ?? null,
      }))[0];
      return { status: r?.out_status === "duplicate" ? "duplicate" : "emitted", id: String(r?.out_id ?? "") };
    },
    async claim(limit, leaseSeconds) {
      return rows(await rpc(db, "claim_domain_events", { p_limit: limit, p_lease_seconds: leaseSeconds })).map((r) => ({
        id: String(r.id), tenantId: String(r.organization_id), type: String(r.type), payload: r.payload, attempts: Number(r.attempts),
      }));
    },
    async complete(id) {
      await rpc(db, "complete_domain_event", { p_id: id });
    },
    async fail(id, error, maxAttempts) {
      const out = await rpc(db, "fail_domain_event", { p_id: id, p_error: error, p_max_attempts: maxAttempts });
      return out === "dead" || out === "retry" ? out : "ignored";
    },
  };
}

export function createSupabaseScheduledTaskRepository(db: SupabaseClient = getSupabaseServiceClient()): ScheduledTaskRepository {
  return {
    async claim(limit, leaseSeconds) {
      return rows(await rpc(db, "claim_scheduled_tasks", { p_limit: limit, p_lease_seconds: leaseSeconds })).map((r) => ({
        id: String(r.id), tenantId: String(r.organization_id), createdBy: String(r.created_by),
        agentName: String(r.agent_name), instruction: String(r.instruction), title: (r.title as string | null) ?? null,
      }));
    },
    async complete(id, ok, status, maxFailures) {
      return String(await rpc(db, "complete_scheduled_task", { p_id: id, p_ok: ok, p_status: status, p_max_failures: maxFailures }));
    },
  };
}

export function createSupabaseMaintenanceRepository(db: SupabaseClient = getSupabaseServiceClient()): MaintenanceRepository {
  return {
    closeStuckRuns: async (s) => Number(await rpc(db, "close_stuck_agent_runs", { p_older_than_seconds: s })),
    purgeRuns: async (d) => Number(await rpc(db, "purge_agent_runs", { p_before: d.toISOString() })),
    purgeEvents: async (d) => Number(await rpc(db, "purge_domain_events", { p_before: d.toISOString() })),
    purgeMemory: async (d) => Number(await rpc(db, "memory_purge", { p_archived_before: d.toISOString() })),
  };
}
