/**
 * Planificateur d'agents (P4). Une tâche s'exécute avec les droits de son
 * CRÉATEUR, résolus à chaque exécution (canal `scheduler`) : un créateur
 * retiré de l'organisation, ou rétrogradé, ne peut plus rien déclencher.
 * Les actions `confirm`/`sensitive` restent soumises à approbation humaine.
 */
import type { Actor } from "./contracts";
import type { RunResult } from "./runtime";

export interface ScheduledTaskRow {
  id: string;
  tenantId: string;
  createdBy: string;
  agentName: string;
  instruction: string;
  title?: string | null;
}

export interface ScheduledTaskRepository {
  claim(limit: number, leaseSeconds: number): Promise<ScheduledTaskRow[]>;
  complete(id: string, ok: boolean, status: string, maxFailures: number): Promise<string>;
}

export interface SchedulerDeps {
  repo: ScheduledTaskRepository;
  /** Acteur actuel du créateur (null s'il n'est plus membre). */
  resolveActor: (userId: string, tenantId: string) => Promise<Actor | null>;
  runAgent: (input: { actor: Actor; agentName: string; message: string }) => Promise<Pick<RunResult, "status" | "errorCode"> & { text?: string }>;
  /** Livraison du résultat au créateur (texte + cartes de validation). Au mieux : un échec n'invalide jamais l'exécution. */
  deliver?: (task: ScheduledTaskRow, creator: Actor, result: Awaited<ReturnType<SchedulerDeps["runAgent"]>>) => Promise<void>;
  batchSize?: number;
  leaseSeconds?: number;
  maxFailures?: number;
}

export interface SchedulerReport {
  claimed: number;
  ok: number;
  failed: number;
}

/** Statuts de run considérés comme réussis (l'attente d'approbation n'est pas un échec). */
const OK_STATUSES = new Set(["completed", "awaiting_approval"]);

export function createAgentScheduler(deps: SchedulerDeps) {
  const maxFailures = deps.maxFailures ?? 5;
  return {
    async tick(): Promise<SchedulerReport> {
      const tasks = await deps.repo.claim(deps.batchSize ?? 20, deps.leaseSeconds ?? 600);
      const report: SchedulerReport = { claimed: tasks.length, ok: 0, failed: 0 };
      for (const task of tasks) {
        let ok = false;
        let status = "failed";
        try {
          const creator = await deps.resolveActor(task.createdBy, task.tenantId);
          if (!creator) {
            status = "creator_not_member";
          } else {
            const result = await deps.runAgent({
              actor: { ...creator, channel: "scheduler" },
              agentName: task.agentName,
              message: task.instruction,
            });
            ok = OK_STATUSES.has(result.status);
            if (deps.deliver) {
              try { await deps.deliver(task, creator, result); } catch (error) { console.error("[agents] livraison du résultat impossible:", error instanceof Error ? error.message : error); }
            }
            status = ok ? result.status : (result.errorCode ?? result.status);
          }
        } catch {
          status = "exception";
        }
        // Une absence de droits est définitive : on force la désactivation immédiate.
        const budget = status === "creator_not_member" ? 1 : maxFailures;
        try {
          await deps.repo.complete(task.id, ok, status, budget);
        } catch {
          // Le bail expirera et la tâche sera reprise : jamais de perte silencieuse.
        }
        if (ok) report.ok += 1;
        else report.failed += 1;
      }
      return report;
    },
  };
}
