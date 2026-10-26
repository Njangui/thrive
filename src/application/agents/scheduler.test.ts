import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./contracts";
import { createAgentScheduler, type ScheduledTaskRepository, type ScheduledTaskRow } from "./scheduler";
import { runMaintenance, type MaintenanceRepository } from "./maintenance";

const task: ScheduledTaskRow = { id: "s1", tenantId: "t1", createdBy: "u1", agentName: "employee", instruction: "relance" };
const actor: Actor = { userId: "u1", tenantId: "t1", role: "employee", extraPermissions: [], channel: "dashboard" };
const repo = (): ScheduledTaskRepository => ({ claim: vi.fn(async () => [task]), complete: vi.fn(async () => "rescheduled") });

describe("scheduler", () => {
  it("exécute avec les droits du créateur, canal scheduler", async () => {
    const r = repo();
    const runAgent = vi.fn(async () => ({ status: "completed" as const }));
    const rep = await createAgentScheduler({ repo: r, resolveActor: async () => actor, runAgent }).tick();
    expect(runAgent).toHaveBeenCalledWith({ actor: { ...actor, channel: "scheduler" }, agentName: "employee", message: "relance" });
    expect(r.complete).toHaveBeenCalledWith("s1", true, "completed", 5);
    expect(rep).toEqual({ claimed: 1, ok: 1, failed: 0 });
  });

  it("créateur plus membre : aucune exécution, désactivation immédiate", async () => {
    const r = repo();
    const runAgent = vi.fn();
    await createAgentScheduler({ repo: r, resolveActor: async () => null, runAgent }).tick();
    expect(runAgent).not.toHaveBeenCalled();
    expect(r.complete).toHaveBeenCalledWith("s1", false, "creator_not_member", 1);
  });

  it("awaiting_approval n'est pas un échec ; un run failed l'est, avec son code", async () => {
    const a = repo();
    await createAgentScheduler({ repo: a, resolveActor: async () => actor, runAgent: async () => ({ status: "awaiting_approval" }) }).tick();
    expect(a.complete).toHaveBeenCalledWith("s1", true, "awaiting_approval", 5);
    const b = repo();
    await createAgentScheduler({ repo: b, resolveActor: async () => actor, runAgent: async () => ({ status: "failed", errorCode: "insufficient_credits" }), maxFailures: 3 }).tick();
    expect(b.complete).toHaveBeenCalledWith("s1", false, "insufficient_credits", 3);
  });

  it("une exception d'exécution est comptée comme échec sans faire tomber le tick", async () => {
    const r = repo();
    const rep = await createAgentScheduler({ repo: r, resolveActor: async () => { throw new Error("db"); }, runAgent: vi.fn() }).tick();
    expect(rep.failed).toBe(1);
    expect(r.complete).toHaveBeenCalledWith("s1", false, "exception", 5);
  });

  it("un échec de complete() ne casse pas la boucle", async () => {
    const r = { claim: vi.fn(async () => [task, { ...task, id: "s2" }]), complete: vi.fn(async () => { throw new Error("db"); }) };
    const rep = await createAgentScheduler({ repo: r, resolveActor: async () => actor, runAgent: async () => ({ status: "completed" }) }).tick();
    expect(rep.ok).toBe(2);
  });
});

describe("maintenance", () => {
  const mrepo = (): MaintenanceRepository => ({ closeStuckRuns: vi.fn(async () => 2), purgeRuns: vi.fn(async () => 5), purgeEvents: vi.fn(async () => 7), purgeMemory: vi.fn(async () => 3) });
  const now = () => new Date("2026-10-09T00:00:00Z");

  it("sans durée de rétention : rien n'est purgé (défaut sûr)", async () => {
    const r = mrepo();
    expect(await runMaintenance(r, { stuckRunAfterSeconds: 1800 }, now)).toEqual({ stuckClosed: 2, runsPurged: 0, eventsPurged: 0, memoryPurged: 0 });
    expect(r.purgeRuns).not.toHaveBeenCalled(); expect(r.purgeEvents).not.toHaveBeenCalled(); expect(r.purgeMemory).not.toHaveBeenCalled();
  });

  it("purge selon les durées fournies et borne le délai de run bloqué à 60 s minimum", async () => {
    const r = mrepo();
    const out = await runMaintenance(r, { stuckRunAfterSeconds: 5, runRetentionDays: 90, eventRetentionDays: 30, memoryArchiveRetentionDays: 60 }, now);
    expect(out).toEqual({ stuckClosed: 2, runsPurged: 5, eventsPurged: 7, memoryPurged: 3 });
    expect(r.purgeMemory).toHaveBeenCalledWith(new Date("2026-08-10T00:00:00Z"));
    expect(r.closeStuckRuns).toHaveBeenCalledWith(60);
    expect(r.purgeRuns).toHaveBeenCalledWith(new Date("2026-07-11T00:00:00Z"));
    expect(r.purgeEvents).toHaveBeenCalledWith(new Date("2026-09-09T00:00:00Z"));
  });
});
