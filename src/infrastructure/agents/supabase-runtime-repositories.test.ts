import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseCircuitBreakerRepository, SupabaseRunStore } from "./supabase-runtime-repositories";

/** Faux client qui enregistre la chaîne d'appels et résout avec `result`. */
function recorder(result: { data?: unknown; error?: { code?: string; message: string } | null } = { data: [], error: null }) {
  const calls: Array<{ table: string; chain: Array<[string, unknown[]]> }> = [];
  const client = {
    from(table: string) {
      const entry = { table, chain: [] as Array<[string, unknown[]]> };
      calls.push(entry);
      const proxy: unknown = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: result.data ?? [], error: result.error ?? null });
          return (...args: unknown[]) => { entry.chain.push([prop, args]); return proxy; };
        },
      });
      return proxy;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}
const has = (call: { chain: Array<[string, unknown[]]> }, method: string, ...args: unknown[]) =>
  call.chain.some(([m, a]) => m === method && JSON.stringify(a) === JSON.stringify(args));

describe("SupabaseRunStore", () => {
  it("mappe run et pas vers les colonnes de la migration 0103", async () => {
    const { client, calls } = recorder();
    const store = new SupabaseRunStore(client);
    await store.createRun({ id: "r1", tenantId: "t1", agentName: "orchestrator", promptVersion: "v1", actorUserId: "u1", channel: "dashboard", depth: 0, modelTier: "small" });
    await store.addStep({ runId: "r1", tenantId: "t1", stepIndex: 0, kind: "llm", inputTokens: 1, outputTokens: 2, units: 1, status: "ok", durationMs: 12.6, detail: {} });
    const [run, step] = calls.map((c) => c.chain[0]![1][0] as Record<string, unknown>);
    expect(run).toMatchObject({ organization_id: "t1", agent_name: "orchestrator", parent_run_id: null, model_tier: "small" });
    expect(step).toMatchObject({ organization_id: "t1", run_id: "r1", step_index: 0, duration_ms: 13, tool_name: null });
  });

  it("clôture : filtrée par tenant ET par id (jamais l'un sans l'autre)", async () => {
    const { client, calls } = recorder();
    await new SupabaseRunStore(client).finishRun("r1", "t1", { status: "completed", stepsCount: 2, unitsUsed: 1, inputTokens: 3, outputTokens: 4 });
    expect(has(calls[0]!, "eq", "organization_id", "t1")).toBe(true);
    expect(has(calls[0]!, "eq", "id", "r1")).toBe(true);
  });

  it("propage les erreurs base", async () => {
    const { client } = recorder({ error: { message: "boom" } });
    await expect(new SupabaseRunStore(client).createRun({ id: "r", tenantId: "t", agentName: "a", promptVersion: "v", actorUserId: "u", channel: "dashboard", depth: 0, modelTier: "small" })).rejects.toThrow(/insertion impossible/);
  });
});

describe("SupabaseCircuitBreakerRepository", () => {
  it("isOpen : tenant + non relâché + (tous les agents OU cet agent) ; nom invalide refusé", async () => {
    const { client, calls } = recorder({ data: [{ id: "x" }] });
    const repo = new SupabaseCircuitBreakerRepository(client);
    expect(await repo.isOpen("t1", "catalog")).toBe(true);
    expect(has(calls[0]!, "eq", "organization_id", "t1")).toBe(true);
    expect(has(calls[0]!, "is", "released_at", null)).toBe(true);
    expect(has(calls[0]!, "or", "agent_name.is.null,agent_name.eq.catalog")).toBe(true);
    await expect(repo.isOpen("t1", "x,agent_name.neq.y")).rejects.toThrow(/invalide/);
    expect(await new SupabaseCircuitBreakerRepository(recorder({ data: [] }).client).isOpen("t1", "catalog")).toBe(false);
  });

  it("trip idempotent sur doublon (23505), erreur sinon ; release ciblé", async () => {
    await expect(new SupabaseCircuitBreakerRepository(recorder({ error: { code: "23505", message: "dup" } }).client).trip({ tenantId: "t", agentName: null, trippedBy: null, reason: "x" })).resolves.toBeUndefined();
    await expect(new SupabaseCircuitBreakerRepository(recorder({ error: { code: "XX000", message: "boom" } }).client).trip({ tenantId: "t", agentName: null, trippedBy: null, reason: "x" })).rejects.toThrow();
    const { client, calls } = recorder();
    await new SupabaseCircuitBreakerRepository(client).release({ tenantId: "t1", agentName: null, releasedBy: "u1" });
    expect(has(calls[0]!, "eq", "organization_id", "t1")).toBe(true);
    expect(has(calls[0]!, "is", "agent_name", null)).toBe(true);
  });
});
