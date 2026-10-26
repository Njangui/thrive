/**
 * Implémentations Supabase / Upstash des ports du runtime (C1 / P2).
 * Service-role : ces tables n'ont pas de policy d'écriture (0103), donc
 * CHAQUE requête filtre explicitement par `organization_id`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { CircuitBreakerRepository, RunRateLimiter } from "@/application/agents/run-gate";
import type { RunFinish, RunRecord, RunStore, StepRecord } from "@/application/agents/run-store";
import type { ModelRouter } from "@/application/agents/runtime";
import { getAIProviderForTier } from "@/infrastructure/providers/registry";
import { isRateLimitRequired, reportRateLimitFailure } from "@/lib/rate-limit";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

const AGENT_NAME = /^[a-z][a-z0-9_]*$/;

export class SupabaseRunStore implements RunStore {
  constructor(private readonly client: SupabaseClient = getSupabaseServiceClient()) {}

  async createRun(run: RunRecord): Promise<void> {
    const { error } = await this.client.from("agent_runs").insert({
      id: run.id,
      organization_id: run.tenantId,
      agent_name: run.agentName,
      prompt_version: run.promptVersion,
      actor_user_id: run.actorUserId,
      channel: run.channel,
      parent_run_id: run.parentRunId ?? null,
      depth: run.depth,
      model_tier: run.modelTier,
    });
    if (error) throw new Error(`agent_runs: insertion impossible (${error.message})`);
  }

  async addStep(step: StepRecord): Promise<void> {
    const { error } = await this.client.from("agent_steps").insert({
      run_id: step.runId,
      organization_id: step.tenantId,
      step_index: step.stepIndex,
      kind: step.kind,
      tool_name: step.toolName ?? null,
      provider: step.provider ?? null,
      model: step.model ?? null,
      prompt_version: step.promptVersion ?? null,
      input_tokens: step.inputTokens,
      output_tokens: step.outputTokens,
      units: step.units,
      status: step.status,
      error_code: step.errorCode ?? null,
      duration_ms: Math.max(0, Math.round(step.durationMs)),
      detail: step.detail,
    });
    if (error) throw new Error(`agent_steps: insertion impossible (${error.message})`);
  }

  async finishRun(runId: string, tenantId: string, finish: RunFinish): Promise<void> {
    const { error } = await this.client
      .from("agent_runs")
      .update({
        status: finish.status,
        steps_count: finish.stepsCount,
        units_used: finish.unitsUsed,
        input_tokens: finish.inputTokens,
        output_tokens: finish.outputTokens,
        error_code: finish.errorCode ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("organization_id", tenantId)
      .eq("id", runId);
    if (error) throw new Error(`agent_runs: clôture impossible (${error.message})`);
  }
}

export class SupabaseCircuitBreakerRepository implements CircuitBreakerRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServiceClient()) {}

  async isOpen(tenantId: string, agentName: string): Promise<boolean> {
    if (!AGENT_NAME.test(agentName)) throw new Error("agent_circuit_breakers: nom d'agent invalide");
    const { data, error } = await this.client
      .from("agent_circuit_breakers")
      .select("id")
      .eq("organization_id", tenantId)
      .is("released_at", null)
      .or(`agent_name.is.null,agent_name.eq.${agentName}`)
      .limit(1);
    if (error) throw new Error(`agent_circuit_breakers: lecture impossible (${error.message})`);
    return (data?.length ?? 0) > 0;
  }

  async trip(args: { tenantId: string; agentName: string | null; trippedBy: string | null; reason: string }): Promise<void> {
    if (args.agentName !== null && !AGENT_NAME.test(args.agentName)) throw new Error("agent_circuit_breakers: nom d'agent invalide");
    const { error } = await this.client.from("agent_circuit_breakers").insert({
      organization_id: args.tenantId,
      agent_name: args.agentName,
      tripped_by: args.trippedBy,
      reason: args.reason.slice(0, 200),
    });
    // 23505 : déjà armé (index unique partiel) => idempotent.
    if (error && error.code !== "23505") throw new Error(`agent_circuit_breakers: armement impossible (${error.message})`);
  }

  async release(args: { tenantId: string; agentName: string | null; releasedBy: string }): Promise<void> {
    if (args.agentName !== null && !AGENT_NAME.test(args.agentName)) throw new Error("agent_circuit_breakers: nom d'agent invalide");
    let query = this.client
      .from("agent_circuit_breakers")
      .update({ released_at: new Date().toISOString(), released_by: args.releasedBy })
      .eq("organization_id", args.tenantId)
      .is("released_at", null);
    query = args.agentName === null ? query.is("agent_name", null) : query.eq("agent_name", args.agentName);
    const { error } = await query;
    if (error) throw new Error(`agent_circuit_breakers: relâchement impossible (${error.message})`);
  }
}

/**
 * Limiteur Upstash dédié aux exécutions d'agents (préfixes propres). Même
 * repli que `src/lib/rate-limit.ts` : sans Upstash configuré, ne bloque pas.
 * Plafonds = quantités d'exécutions, pas des prix.
 */
export function createUpstashRunRateLimiter(prefix: string, limit: number, windowSeconds: number): RunRateLimiter {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Audit QA8 / Q33 : même règle que src/lib/rate-limit.ts.
    if (isRateLimitRequired()) return { hit: async () => { reportRateLimitFailure("RATE_LIMIT_REQUIRED=true mais Upstash absent : exécutions d'agents refusées."); return false; } };
    return { hit: async () => true };
  }
  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix: `ratelimit:agents:${prefix}`,
  });
  return {
    hit: async (key) => {
      try {
        return (await limiter.limit(key)).success;
      } catch (error) {
        reportRateLimitFailure("Upstash indisponible (agents) : repli ouvert.", error);
        return true;
      }
    },
  };
}

export const AGENT_RUN_LIMITS = { perUser: { limit: 20, windowSeconds: 60 }, perTenant: { limit: 120, windowSeconds: 60 } } as const;

/** `small` = modèle du tenant (`ai_config`) ; `large` = modèle large de la même famille. */
export class SupabaseModelRouter implements ModelRouter {
  async forTier(tenantId: string, tier: "small" | "large") {
    const bundle = await getAIProviderForTier(tenantId, tier);
    return { primary: bundle.primary, fallback: bundle.fallback };
  }
}
