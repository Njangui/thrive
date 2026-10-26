/** Assemblage de production du tick agentique (P4). */
import { resolveActor } from "@/application/agents/actor";
import { runMaintenance } from "@/application/agents/maintenance";
import { createAgentScheduler } from "@/application/agents/scheduler";
import { createEventDispatcher, type EventHandlers } from "@/application/events/outbox";
import { buildKernelRuntime } from "./production-runtime";
import { deliverScheduledResult } from "./scheduled-delivery";
import { SupabaseMembershipLoader } from "./supabase-agent-repositories";
import {
  createSupabaseMaintenanceRepository,
  createSupabaseOutboxRepository,
  createSupabaseScheduledTaskRepository,
} from "./supabase-scheduling-repositories";

/** Handlers d'événements : chaque périmètre (C2…C5) y branche les siens. Aucun pour l'instant. */
export const EVENT_HANDLERS: EventHandlers = {};

/** Entier positif lu dans l'environnement ; absent/invalide => undefined (pas de purge). */
export function positiveIntEnv(name: string): number | undefined {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : undefined;
}

async function step<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (error) {
    return { error: error instanceof Error ? error.message.slice(0, 200) : "erreur" };
  }
}

export async function runAgentsTick() {
  const events = await step(() => createEventDispatcher({ repo: createSupabaseOutboxRepository(), handlers: EVENT_HANDLERS }).dispatch());
  const scheduler = await step(async () => {
    // Les tâches planifiées ne tournent que si l'assistant est activé (mêmes crédits mesurés, mêmes règles de validation).
    if (process.env.AGENT_RUNTIME_ENABLED !== "true") return { claimed: 0, ok: 0, failed: 0, skipped: "assistant_disabled" };
    const runtime = buildKernelRuntime();
    const loader = new SupabaseMembershipLoader();
    return createAgentScheduler({
      repo: createSupabaseScheduledTaskRepository(),
      resolveActor: (userId, tenantId) => resolveActor({ userId, tenantId, channel: "scheduler" }, loader),
      runAgent: (input) => runtime.runScheduled(input),
      deliver: (task, creator, result) => deliverScheduledResult(task, creator, { text: result.text, cards: (result as { cards?: never[] }).cards, runId: (result as { runId?: string }).runId }),
    }).tick();
  });
  const maintenance = await step(() =>
    runMaintenance(createSupabaseMaintenanceRepository(), {
      stuckRunAfterSeconds: positiveIntEnv("AGENT_STUCK_RUN_SECONDS") ?? 1800,
      runRetentionDays: positiveIntEnv("AGENT_RUN_RETENTION_DAYS"),
      eventRetentionDays: positiveIntEnv("AGENT_EVENT_RETENTION_DAYS"),
      memoryArchiveRetentionDays: positiveIntEnv("AGENT_MEMORY_ARCHIVE_RETENTION_DAYS"),
    }),
  );
  return { events, scheduler, maintenance };
}
