import { describe, expect, it, vi } from "vitest";
import { createPendingActionService } from "../pending-actions";
import { createActionEvaluator } from "../rule-engine";
import { createAgentKernel } from "../tool-registry";
import { createTenantScopedDb } from "../tenant-scoped-db";
import { executeTool, type RuntimeDeps } from "../execute-tool";
import { InMemoryAuditSink, InMemoryPendingRepo, InMemorySettingsRepo } from "../testing/in-memory";
import { FakeSupabase } from "../testing/fake-supabase";
import type { Actor } from "../contracts";
import type { TaskService } from "../task-service";
import { buildTaskTools } from "./tasks";

const T = "11111111-1111-4111-8111-111111111111";
const owner: Actor = { userId: "u1", tenantId: "t1", membershipId: "m1", role: "owner", extraPermissions: [], channel: "dashboard" };

function setup() {
  const svc = { list: vi.fn(async () => []), create: vi.fn(async () => ({ id: T, nextRunAt: "x" })), pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), remove: vi.fn(async () => {}) } as unknown as TaskService;
  const kernel = createAgentKernel();
  for (const { tool, roles } of buildTaskTools(() => svc)) kernel.registerTool(tool, { roles });
  const settings = new InMemorySettingsRepo();
  settings.withDefaults("t1", { profile: "autonomous" });
  const pending = createPendingActionService({ repo: new InMemoryPendingRepo(), matrix: kernel.matrix });
  const deps: RuntimeDeps = {
    registry: kernel.registry, evaluate: createActionEvaluator({ settings, matrix: kernel.matrix, pending }), pending, audit: new InMemoryAuditSink(),
    usage: { charge: async () => ({ status: "charged" }) }, makeDb: (t) => createTenantScopedDb(new FakeSupabase({}) as never, t),
  };
  return { svc, run: (n: string, i: unknown, a: Actor = owner) => executeTool(deps, a, { toolName: n, input: i, runId: "r" }) };
}
const valid = { title: "Résumé", instruction: "Résume les commandes d'hier", firstRunAt: "2026-10-24T08:00", repeatEveryHours: 24 };

describe("outils de tâches planifiées", () => {
  it("créer une tâche demande TOUJOURS validation, même en mode autonome", async () => {
    const { run, svc } = setup();
    expect((await run("tasks.create", valid)).status).toBe("pending_confirmation");
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("une tâche planifiée ne peut pas créer, modifier ni supprimer des tâches", async () => {
    const { run, svc } = setup();
    const sched: Actor = { ...owner, channel: "scheduler" };
    for (const [n, i] of [["tasks.create", valid], ["tasks.pause", { taskId: T }], ["tasks.delete", { taskId: T }]] as const) {
      const r = await run(n, i, sched);
      expect(["error", "denied", "pending_confirmation"]).toContain(r.status);
    }
    expect(svc.pause).not.toHaveBeenCalled();
    expect(svc.remove).not.toHaveBeenCalled();
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("pause, reprise, suppression libres ; liste en lecture", async () => {
    const { run, svc } = setup();
    expect((await run("tasks.pause", { taskId: T })).status).toBe("ok");
    expect((await run("tasks.resume", { taskId: T })).status).toBe("ok");
    expect((await run("tasks.delete", { taskId: T })).status).toBe("ok");
    expect((await run("tasks.list", {})).status).toBe("ok");
    expect(svc.pause).toHaveBeenCalledWith("t1", T);
  });

  it("réservé propriétaire/admin ; entrées strictes", async () => {
    const { run } = setup();
    expect((await run("tasks.list", {}, { ...owner, role: "manager" })).status).toBe("denied");
    expect((await run("tasks.list", {}, { ...owner, channel: "customer" })).status).toBe("denied");
    expect((await run("tasks.create", { ...valid, repeatEveryHours: 0 })).status).toBe("denied");
    expect((await run("tasks.create", { ...valid, firstRunAt: "demain" })).status).toBe("denied");
    expect((await run("tasks.pause", { taskId: "pas-un-uuid" })).status).toBe("denied");
  });
});
