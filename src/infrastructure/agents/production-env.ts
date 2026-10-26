/**
 * Assemblage de production du runtime d'agents. `usage` est OBLIGATOIRE : il
 * n'existe volontairement aucun défaut « gratuit » (un agent non mesuré ne
 * doit pas pouvoir tourner par oubli). L'implémentation arrive en P3
 * (`usage_ledger` / `wallet_balances`).
 */
import type { StepUpPort, UsageService } from "@/application/agents/contracts";
import { createAgentRuntime, type RuntimeHooks } from "@/application/agents/runtime";
import { createPendingActionService } from "@/application/agents/pending-actions";
import { createActionEvaluator } from "@/application/agents/rule-engine";
import { composeGates, createCircuitBreakerGate, createRateLimitGate } from "@/application/agents/run-gate";
import { createTenantScopedDb } from "@/application/agents/tenant-scoped-db";
import { getAgentKernel } from "@/application/agents/kernel";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import {
  SupabaseAgentSettingsRepository,
  SupabaseAuditSink,
  SupabasePendingActionRepository,
} from "./supabase-agent-repositories";
import {
  AGENT_RUN_LIMITS,
  createUpstashRunRateLimiter,
  SupabaseCircuitBreakerRepository,
  SupabaseModelRouter,
  SupabaseRunStore,
} from "./supabase-runtime-repositories";

export function createProductionAgentRuntime(deps: { usage: UsageService; stepUp?: StepUpPort; hooks?: RuntimeHooks }) {
  const { kernel, agents } = getAgentKernel();
  const client = getSupabaseServiceClient();
  const settings = new SupabaseAgentSettingsRepository(client);
  const pending = createPendingActionService({
    repo: new SupabasePendingActionRepository(client),
    matrix: kernel.matrix,
    stepUp: deps.stepUp,
    hasOtherApprover: async (tenantId, requesterUserId) => {
      const { data, error } = await client
        .from("memberships")
        .select("user_id")
        .eq("organization_id", tenantId)
        .in("role", ["owner", "admin", "manager"])
        .neq("user_id", requesterUserId)
        .limit(1);
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },
  });
  return createAgentRuntime({
    registry: kernel.registry,
    evaluate: createActionEvaluator({ settings, matrix: kernel.matrix, pending }),
    pending,
    audit: new SupabaseAuditSink(client),
    usage: deps.usage,
    makeDb: (tenantId) => createTenantScopedDb(client, tenantId),
    agents,
    models: new SupabaseModelRouter(),
    runs: new SupabaseRunStore(client),
    settings,
    matrix: kernel.matrix,
    gate: composeGates(
      createCircuitBreakerGate(new SupabaseCircuitBreakerRepository(client)),
      createRateLimitGate({
        perUser: createUpstashRunRateLimiter("user", AGENT_RUN_LIMITS.perUser.limit, AGENT_RUN_LIMITS.perUser.windowSeconds),
        perTenant: createUpstashRunRateLimiter("tenant", AGENT_RUN_LIMITS.perTenant.limit, AGENT_RUN_LIMITS.perTenant.windowSeconds),
      }),
    ),
    hooks: deps.hooks,
  });
}
