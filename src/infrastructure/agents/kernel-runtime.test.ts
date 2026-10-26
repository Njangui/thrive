import { describe, expect, it, vi } from "vitest";
import { executeTool, approvePendingAction, executeApprovedAction } from "@/application/agents/execute-tool";
import { buildHarness, TENANT_A } from "@/application/agents/testing/harness";
import type { AgentActor } from "@/application/channels/actor";
import { computeActionFingerprint } from "@/application/channels/action-fingerprint";
import { KernelAgentRuntime, allowedMethodsFor } from "./kernel-runtime";
import { createStepUpBridge } from "./step-up-bridge";

const owner: AgentActor = { userId: "user-owner", tenantId: TENANT_A, membershipId: "m-owner", role: "owner", extraPermissions: [], channel: "dashboard" };

function setup(consumeOk = true) {
  const consume = vi.fn(async () => (consumeOk ? { ok: true as const } : { ok: false as const, reason: "not_approved" as const }));
  const holder: { get?: (t: string, id: string) => Promise<{ toolName: string; params: unknown } | null> } = {};
  const bridge = createStepUpBridge({ stepUp: { consume }, pending: { get: async (t, id) => (holder.get ? holder.get(t, id) : null) } });
  const h = buildHarness({ stepUp: bridge.port });
  holder.get = h.deps.pending.get;
  const createChallenge = vi.fn(async (input: { allowedMethods: string[] }) => ({ challengeId: "ch-1", expiresAt: "2099-01-01T00:00:00Z", allowedMethods: input.allowedMethods as never, linkToken: "tok" }));
  const runAgent = vi.fn();
  const runtime = new KernelAgentRuntime({
    runtime: {
      runAgent,
      approve: (a, c) => approvePendingAction(h.deps, a, c),
      execute: (a, c) => executeApprovedAction(h.deps, a, c),
      reject: (approver, id) => h.deps.pending.reject({ approver, pendingActionId: id }),
      registry: h.kernel.registry,
      pending: h.deps.pending,
      settings: h.settings,
      matrix: h.kernel.matrix,
    },
    stepUp: { createChallenge: createChallenge as never },
    bridge,
  });
  return { h, runtime, runAgent, consume, createChallenge };
}

async function collect(it: AsyncIterable<unknown>) { const out: unknown[] = []; for await (const e of it) out.push(e); return out; }

describe("KernelAgentRuntime", () => {
  it("renvoie texte, carte d'approbation avec défi de validation renforcée, puis done", async () => {
    const { h, runtime, runAgent, createChallenge } = setup();
    const outcome = await executeTool(h.deps, { ...owner }, { toolName: "catalog.update_price", input: { productId: "p1", price: 12 }, runId: "run-1" });
    expect(outcome.status).toBe("pending_confirmation");
    const pendingActionId = (outcome as { pendingActionId: string }).pendingActionId;
    runAgent.mockResolvedValue({ runId: "run-1", status: "awaiting_approval", text: "En attente.", pendingApprovals: [{ pendingActionId, toolName: "catalog.update_price", reason: "x" }] });
    const events = (await collect(runtime.run({ actor: owner, threadId: "t", text: "change le prix", attachments: [], history: [] }))) as { type: string; card?: { stepUp?: { challengeId: string }; risk: string } }[];
    expect(events.map((e) => e.type)).toEqual(["text_delta", "approval_required", "done"]);
    expect(events[1]!.card!.risk).toBe("sensitive");
    expect(events[1]!.card!.stepUp!.challengeId).toBe("ch-1");
    const call = createChallenge.mock.calls[0]![0] as { actionFingerprint: string; pendingActionId: string; allowedMethods: string[] };
    expect(call.actionFingerprint).toBe(computeActionFingerprint("catalog.update_price", { productId: "p1", price: 12 }));
    expect(call.allowedMethods).toEqual(["pin", "dashboard_link"]);
  });

  it("approuve puis exécute avec le défi consommé une seule fois", async () => {
    const { h, runtime, consume } = setup();
    const o = (await executeTool(h.deps, { ...owner }, { toolName: "catalog.update_price", input: { productId: "p1", price: 12 }, runId: "run-1" })) as { pendingActionId: string };
    const res = await runtime.decideApproval({ actor: { ...owner }, pendingActionId: o.pendingActionId, decision: "approve", stepUp: { challengeId: "ch-1" } });
    expect(res.status).toBe("executed");
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith({ challengeId: "ch-1", organizationId: TENANT_A, membershipId: "m-owner", actionFingerprint: computeActionFingerprint("catalog.update_price", { productId: "p1", price: 12 }) });
    expect(h.db.rows("products").find((p) => p.id === "p1")!.price).toBe(12);
    // rejouer : plus en attente
    const again = await runtime.decideApproval({ actor: { ...owner }, pendingActionId: o.pendingActionId, decision: "approve", stepUp: { challengeId: "ch-1" } });
    expect(again.status).toBe("failed");
  });

  it("refuse une action sensible sans défi valide (fail-closed) et ne modifie rien", async () => {
    const { h, runtime } = setup(false);
    const o = (await executeTool(h.deps, { ...owner }, { toolName: "catalog.update_price", input: { productId: "p1", price: 99 }, runId: "run-1" })) as { pendingActionId: string };
    const res = await runtime.decideApproval({ actor: { ...owner }, pendingActionId: o.pendingActionId, decision: "approve", stepUp: { challengeId: "ch-1" } });
    expect(res.status).toBe("failed");
    expect(h.db.rows("products").find((p) => p.id === "p1")!.price).toBe(10);
    const none = await runtime.decideApproval({ actor: { ...owner }, pendingActionId: o.pendingActionId, decision: "approve" });
    expect(none.status).toBe("failed");
  });

  it("rejet et action d'un autre tenant", async () => {
    const { h, runtime } = setup();
    const o = (await executeTool(h.deps, { ...owner }, { toolName: "catalog.update_price", input: { productId: "p1", price: 5 }, runId: "r" })) as { pendingActionId: string };
    const other = await runtime.decideApproval({ actor: { ...owner, tenantId: "tenant-b" }, pendingActionId: o.pendingActionId, decision: "reject" });
    expect(other.status).toBe("failed");
    const rej = await runtime.decideApproval({ actor: { ...owner }, pendingActionId: o.pendingActionId, decision: "reject" });
    expect(rej.status).toBe("rejected");
  });

  it("erreurs du runtime : message clair, jamais d'exception", async () => {
    const { runtime, runAgent } = setup();
    runAgent.mockResolvedValue({ runId: "r", status: "failed", text: "", pendingApprovals: [], errorCode: "rate_limited" });
    const events = (await collect(runtime.run({ actor: owner, threadId: "t", text: "x", attachments: [], history: [] }))) as { type: string; code?: string }[];
    expect(events).toEqual([{ type: "error", code: "rate_limited", message: expect.any(String) }]);
    runAgent.mockRejectedValue(new Error("boom"));
    const e2 = (await collect(runtime.run({ actor: owner, threadId: "t", text: "x", attachments: [], history: [] }))) as { code?: string }[];
    expect(e2[0]!.code).toBe("internal");
  });

  it("liste des outils visibles selon le rôle", async () => {
    const { runtime } = setup();
    const owner_ = (await runtime.listVisibleTools(owner)).map((t) => t.name);
    const emp = (await runtime.listVisibleTools({ ...owner, role: "employee" })).map((t) => t.name);
    expect(owner_).toContain("catalog.update_price");
    expect(emp).not.toContain("catalog.update_price");
  });

  it("le bouton Telegram n'est jamais accepté seul pour un remboursement", () => {
    expect(allowedMethodsFor("orders.refund", "telegram")).toEqual(["pin", "dashboard_link"]);
    expect(allowedMethodsFor("products.setPrice", "telegram")).toContain("telegram_button");
    expect(allowedMethodsFor("products.setPrice", "dashboard")).not.toContain("telegram_button");
  });
});
