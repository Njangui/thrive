/**
 * Outbox `domain_events` (P4) : émission idempotente + dispatcher « au moins une
 * fois ». Les charges utiles ne sont jamais journalisées (minimisation) ; une
 * erreur de handler est tronquée avant stockage.
 */
import type { EmitEvent, OutboxEventType } from "@/application/agents/contracts";

export interface OutboxRow {
  id: string;
  tenantId: string;
  type: string;
  payload: unknown;
  attempts: number;
}

export interface OutboxRepository {
  emit(input: { tenantId: string; type: string; payload: unknown; dedupeKey?: string }): Promise<{ status: "emitted" | "duplicate"; id: string }>;
  claim(limit: number, leaseSeconds: number): Promise<OutboxRow[]>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string, maxAttempts: number): Promise<"retry" | "dead" | "ignored">;
}

export function createEmitEvent(repo: OutboxRepository): EmitEvent {
  return async (event) => {
    if (!event.tenantId) throw new Error("emitEvent : tenantId requis");
    await repo.emit({ tenantId: event.tenantId, type: event.type, payload: event.payload, dedupeKey: event.dedupeKey });
  };
}

export type EventHandler = (event: OutboxRow) => Promise<void>;
export type EventHandlers = Partial<Record<OutboxEventType, EventHandler[]>>;

export interface DispatchReport {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
}

export function createEventDispatcher(deps: {
  repo: OutboxRepository;
  handlers: EventHandlers;
  batchSize?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
}) {
  const batchSize = deps.batchSize ?? 50;
  const leaseSeconds = deps.leaseSeconds ?? 120;
  const maxAttempts = deps.maxAttempts ?? 5;
  return {
    async dispatch(): Promise<DispatchReport> {
      const report: DispatchReport = { claimed: 0, done: 0, retried: 0, dead: 0 };
      const rows = await deps.repo.claim(batchSize, leaseSeconds);
      report.claimed = rows.length;
      for (const row of rows) {
        const list = deps.handlers[row.type as OutboxEventType] ?? [];
        try {
          // Tous les handlers doivent réussir ; ils doivent être idempotents (rejeu possible).
          for (const handler of list) await handler(row);
          await deps.repo.complete(row.id);
          report.done += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "erreur";
          const outcome = await deps.repo.fail(row.id, message.slice(0, 300), maxAttempts);
          if (outcome === "dead") report.dead += 1;
          else report.retried += 1;
        }
      }
      return report;
    },
  };
}
