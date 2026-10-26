import { describe, expect, it, vi } from "vitest";
import { createEmitEvent, createEventDispatcher, type OutboxRepository, type OutboxRow } from "./outbox";

const row = (type: string, id = "e1"): OutboxRow => ({ id, tenantId: "t1", type, payload: { productId: "p" }, attempts: 1 });
const repo = (rows: OutboxRow[], over: Partial<OutboxRepository> = {}): OutboxRepository => ({
  emit: vi.fn(async () => ({ status: "emitted" as const, id: "x" })),
  claim: vi.fn(async () => rows),
  complete: vi.fn(async () => undefined),
  fail: vi.fn(async () => "retry" as const),
  ...over,
});

describe("outbox", () => {
  it("émet avec la clé de déduplication et refuse un tenant vide", async () => {
    const r = repo([]);
    const emit = createEmitEvent(r);
    await emit({ tenantId: "t1", type: "ProductChanged", payload: { productId: "p", change: "updated" }, dedupeKey: "k" });
    expect(r.emit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", dedupeKey: "k" }));
    await expect(emit({ tenantId: "", type: "ProductChanged", payload: { productId: "p", change: "created" } })).rejects.toThrow();
  });

  it("appelle tous les handlers puis complète", async () => {
    const a = vi.fn(async () => undefined), b = vi.fn(async () => undefined);
    const r = repo([row("ProductChanged")]);
    const rep = await createEventDispatcher({ repo: r, handlers: { ProductChanged: [a, b] } }).dispatch();
    expect(a).toHaveBeenCalled(); expect(b).toHaveBeenCalled();
    expect(r.complete).toHaveBeenCalledWith("e1");
    expect(rep).toEqual({ claimed: 1, done: 1, retried: 0, dead: 0 });
  });

  it("type sans handler : complété (pas de blocage de la file)", async () => {
    const r = repo([row("Inconnu")]);
    expect((await createEventDispatcher({ repo: r, handlers: {} }).dispatch()).done).toBe(1);
  });

  it("échec d'un handler : fail avec message tronqué, pas de complete, les autres événements continuent", async () => {
    const r = repo([row("ProductChanged", "e1"), row("ProductChanged", "e2")]);
    const h = vi.fn(async (e: OutboxRow) => { if (e.id === "e1") throw new Error("x".repeat(1000)); });
    const rep = await createEventDispatcher({ repo: r, handlers: { ProductChanged: [h] }, maxAttempts: 4 }).dispatch();
    expect(r.fail).toHaveBeenCalledWith("e1", "x".repeat(300), 4);
    expect(r.complete).toHaveBeenCalledWith("e2");
    expect(rep).toMatchObject({ done: 1, retried: 1 });
  });

  it("compte les événements morts", async () => {
    const r = repo([row("ProductChanged")], { fail: vi.fn(async () => "dead" as const) });
    const rep = await createEventDispatcher({ repo: r, handlers: { ProductChanged: [async () => { throw new Error("no"); }] } }).dispatch();
    expect(rep.dead).toBe(1);
  });
});
