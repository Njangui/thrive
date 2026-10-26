/** Doublures en mémoire pour les tests du noyau (aucune E/S). */
import type { AuditEvent, AuditSink } from "../audit";
import type { PendingActionRepository, PendingActionRow, TransitionArgs } from "../pending-actions";
import { defaultAgentSettings, type AgentSettings, type AgentSettingsRepository } from "../settings";

export class InMemoryPendingRepo implements PendingActionRepository {
  readonly rows = new Map<string, PendingActionRow>();
  now: () => Date = () => new Date();

  async insert(row: PendingActionRow): Promise<PendingActionRow> {
    this.rows.set(row.id, structuredClone(row));
    return structuredClone(row);
  }

  async get(tenantId: string, id: string): Promise<PendingActionRow | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? structuredClone(row) : null;
  }

  async transition(args: TransitionArgs): Promise<PendingActionRow | null> {
    const row = this.rows.get(args.id);
    if (!row || row.tenantId !== args.tenantId || !args.from.includes(row.status)) return null;
    if (args.notExpiredAt && new Date(row.expiresAt).getTime() <= new Date(args.notExpiredAt).getTime()) return null;
    row.status = args.to;
    if (args.approvedBy) row.approvedBy = args.approvedBy;
    return structuredClone(row);
  }
}

export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  failing = false;
  async record(event: AuditEvent): Promise<void> {
    if (this.failing) throw new Error("audit down");
    this.events.push(structuredClone(event));
  }
}

export class InMemorySettingsRepo implements AgentSettingsRepository {
  readonly byTenant = new Map<string, AgentSettings>();
  async get(tenantId: string): Promise<AgentSettings | null> {
    return this.byTenant.get(tenantId) ?? null;
  }
  async upsert(settings: AgentSettings): Promise<void> {
    this.byTenant.set(settings.tenantId, settings);
  }
  withDefaults(tenantId: string, patch: Partial<AgentSettings> = {}): void {
    this.byTenant.set(tenantId, { ...defaultAgentSettings(tenantId), ...patch });
  }
}

import type { RunFinish, RunRecord, RunStore, StepRecord } from "../run-store";
import type { CircuitBreakerRepository } from "../run-gate";

export class InMemoryRunStore implements RunStore {
  readonly runs = new Map<string, RunRecord & { finish?: RunFinish }>();
  readonly steps: StepRecord[] = [];
  failCreate = false;
  async createRun(run: RunRecord): Promise<void> {
    if (this.failCreate) throw new Error("trace down");
    this.runs.set(run.id, { ...run });
  }
  async addStep(step: StepRecord): Promise<void> {
    this.steps.push(structuredClone(step));
  }
  async finishRun(runId: string, tenantId: string, finish: RunFinish): Promise<void> {
    const run = this.runs.get(runId);
    if (run && run.tenantId === tenantId) run.finish = finish;
  }
}

export class InMemoryBreakers implements CircuitBreakerRepository {
  readonly active = new Set<string>();
  failing = false;
  private key = (tenantId: string, agent: string | null) => `${tenantId}|${agent ?? "*"}`;
  async isOpen(tenantId: string, agentName: string): Promise<boolean> {
    if (this.failing) throw new Error("db down");
    return this.active.has(this.key(tenantId, null)) || this.active.has(this.key(tenantId, agentName));
  }
  async trip(a: { tenantId: string; agentName: string | null }): Promise<void> {
    this.active.add(this.key(a.tenantId, a.agentName));
  }
  async release(a: { tenantId: string; agentName: string | null }): Promise<void> {
    this.active.delete(this.key(a.tenantId, a.agentName));
  }
}
