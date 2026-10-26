import { describe, expect, it, vi } from "vitest";
import { deliverScheduledResult, SCHEDULED_THREAD_TITLE, type DeliveryDeps } from "./scheduled-delivery";
import { createAgentScheduler } from "@/application/agents/scheduler";
import type { Actor } from "@/application/agents/contracts";

const creator: Actor = { userId: "u1", tenantId: "t1", membershipId: "m1", role: "owner", extraPermissions: [], channel: "scheduler" };
const card = { pendingActionId: "pa", tool: "stock.restock", title: "x", summary: "y", risk: "write_reversible" as const, details: [], expiresAt: "2099-01-01T00:00:00Z" };

function deps() {
  const d = { getThread: vi.fn(async () => ({ id: "th", title: SCHEDULED_THREAD_TITLE, lastMessageAt: "" })), append: vi.fn(async () => "msg"), notify: vi.fn(async () => {}) };
  return { d, typed: d as unknown as DeliveryDeps };
}

describe("livraison des tâches planifiées", () => {
  it("écrit dans le fil du créateur (canal tableau de bord) et notifie quand une validation est attendue", async () => {
    const { d, typed } = deps();
    await deliverScheduledResult({ id: "k", tenantId: "t1", title: "Résumé" }, creator, { text: "Bilan", cards: [card] }, typed);
    expect((d.getThread.mock.calls[0] as unknown[])[0]).toMatchObject({ userId: "u1", channel: "dashboard" });
    expect((d.getThread.mock.calls[0] as unknown[])[1]).toBe(SCHEDULED_THREAD_TITLE);
    const msg = (d.append.mock.calls[0] as unknown[])[2] as { content: string; parts: { state: string }[] };
    expect(msg.content).toContain("Résumé");
    expect(msg.parts[0]!.state).toBe("pending");
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("résultat simple : message sans notification ; rien à dire : rien d'écrit", async () => {
    const a = deps();
    await deliverScheduledResult({ id: "k", tenantId: "t1", title: null }, creator, { text: "Bilan" }, a.typed);
    expect(a.d.append).toHaveBeenCalledTimes(1);
    expect(a.d.notify).not.toHaveBeenCalled();
    const b = deps();
    await deliverScheduledResult({ id: "k", tenantId: "t1", title: null }, creator, { text: "  " }, b.typed);
    expect(b.d.append).not.toHaveBeenCalled();
  });

  it("le planificateur appelle la livraison, et un échec de livraison n'invalide pas l'exécution", async () => {
    const complete = vi.fn(async () => "rescheduled");
    const deliver = vi.fn(async () => { throw new Error("boom"); });
    const s = createAgentScheduler({
      repo: { claim: async () => [{ id: "k", tenantId: "t1", createdBy: "u1", agentName: "assistant", instruction: "ii", title: "T" }], complete },
      resolveActor: async () => creator, runAgent: async () => ({ status: "completed" as const, text: "ok" }), deliver,
    });
    const report = await s.tick();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(report).toEqual({ claimed: 1, ok: 1, failed: 0 });
    expect(complete).toHaveBeenCalledWith("k", true, "completed", 5);
  });
});
