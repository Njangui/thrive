/** Dépôts Supabase de P5 (fonctions SQL de la migration 0107, service-role). */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsentRepository, ConsentScope } from "@/application/feedback/consent-service";
import type { FeedbackRepository } from "@/application/feedback/feedback-service";
import type { FeedbackRow } from "@/application/feedback/feedback-metrics";
import type { ExportRow, TrainingExportRepository } from "@/application/feedback/training-export";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

async function rpc(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

export function createSupabaseFeedbackRepository(db: SupabaseClient = getSupabaseServiceClient()): FeedbackRepository & {
  qualityRows(tenantId: string, since: Date): Promise<FeedbackRow[]>;
} {
  return {
    async record(i) {
      const out = await rpc(db, "record_feedback", {
        p_organization_id: i.tenantId, p_run_id: i.runId, p_actor_id: i.actorId, p_rating: i.rating,
        p_reason: i.reasonCode ?? null, p_comment: i.comment ?? null,
      });
      return out === "recorded" || out === "run_not_found" ? out : "forbidden";
    },
    async recordOutcome(i) {
      const { error } = await db.from("outcome_events").insert({
        organization_id: i.tenantId, run_id: i.runId ?? null, actor_user_id: i.actorId ?? null,
        kind: i.kind, tool_name: i.toolName ?? null, meta: i.meta ?? {},
      });
      if (error) throw new Error(`outcome_events: ${error.message}`);
    },
    async qualityRows(tenantId, since) {
      const { data, error } = await db
        .from("feedback_events")
        .select("rating, reason_code, agent_runs(agent_name, prompt_version)")
        .eq("organization_id", tenantId)
        .gte("created_at", since.toISOString())
        .limit(5000);
      if (error) throw new Error(`feedback_events: ${error.message}`);
      return (data ?? []).flatMap((r: Record<string, unknown>) => {
        const run = (Array.isArray(r.agent_runs) ? r.agent_runs[0] : r.agent_runs) as { agent_name?: string; prompt_version?: string } | null;
        if (!run?.agent_name) return []; // run purgé : exclu des indicateurs par version
        return [{ agentName: run.agent_name, promptVersion: run.prompt_version ?? "?", rating: Number(r.rating), reasonCode: (r.reason_code as string | null) ?? null }];
      });
    },
  };
}

export function createSupabaseConsentRepository(db: SupabaseClient = getSupabaseServiceClient()): ConsentRepository {
  return {
    async has(tenantId, scope: ConsentScope) {
      return (await rpc(db, "has_training_consent", { p_organization_id: tenantId, p_scope: scope })) === true;
    },
    async record(i) {
      const out = await rpc(db, "record_training_consent", {
        p_organization_id: i.tenantId, p_scope: i.scope, p_granted: i.granted, p_decided_by: i.decidedBy, p_policy_version: i.policyVersion,
      });
      return out === "granted" || out === "revoked" ? out : "forbidden";
    },
  };
}

export function createSupabaseTrainingExportRepository(db: SupabaseClient = getSupabaseServiceClient()): TrainingExportRepository {
  return {
    async rows(tenantId, since, limit): Promise<ExportRow[]> {
      const data = await rpc(db, "training_export_rows", { p_organization_id: tenantId, p_since: since?.toISOString() ?? null, p_limit: limit });
      return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
        runId: String(r.run_id), agentName: String(r.agent_name), promptVersion: String(r.prompt_version), modelTier: String(r.model_tier),
        runStatus: String(r.run_status), rating: Number(r.rating), reasonCode: (r.reason_code as string | null) ?? null,
        outcomes: (r.outcomes as string[] | null) ?? [], createdAt: String(r.created_at),
      }));
    },
  };
}
