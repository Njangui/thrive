/** Assemblage de production de l'adaptateur chat ↔ noyau (usage mesuré, validation renforcée C2, agents C1). */
import { createUsageService } from "@/application/usage/usage-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { SupabaseStepUpAdapter } from "@/infrastructure/channels/supabase-step-up-adapter";
import { createSupabaseUsageRepository } from "@/infrastructure/usage/supabase-usage-repositories";
import { KernelAgentRuntime } from "./kernel-runtime";
import { createProductionAgentRuntime } from "./production-env";
import { createStepUpBridge } from "./step-up-bridge";

export function buildKernelRuntime(): KernelAgentRuntime {
  const db = getSupabaseServiceClient();
  const stepUp = new SupabaseStepUpAdapter(db);
  const usage = createUsageService({ repo: createSupabaseUsageRepository(db) });
  // Le pont a besoin de lire les actions en attente, que seul le runtime assemblé connaît : lecture différée.
  const holder: { reader?: { get: (tenantId: string, id: string) => Promise<{ toolName: string; params: unknown } | null> } } = {};
  const bridge = createStepUpBridge({
    stepUp,
    pending: { get: async (tenantId, id) => (holder.reader ? holder.reader.get(tenantId, id) : null) },
  });
  const runtime = createProductionAgentRuntime({ usage, stepUp: bridge.port });
  holder.reader = runtime.pending;
  return new KernelAgentRuntime({ runtime, stepUp, bridge });
}
