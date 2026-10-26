import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
class Query {
  private op: "select" | "update" = "select";
  private patch: Row = {};
  private filters: Array<(r: Row) => boolean> = [];
  constructor(private table: string) {}
  select() { return this; }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  private run() {
    const rows = (db[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") for (const r of rows) Object.assign(r, this.patch);
    return rows;
  }
  maybeSingle() { return Promise.resolve({ data: this.run()[0] ?? null, error: null }); }
  then(res: (v: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: this.run(), error: null }).then(res); }
}
vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({ from: (t: string) => new Query(t) }) }));

import { cancelContactBroadcast } from "./contact-broadcast-service";

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  db.contact_broadcasts = [
    { id: "b1", organization_id: "o1", status: "scheduled" },
    { id: "b2", organization_id: "o1", status: "processing" },
    { id: "b3", organization_id: "o1", status: "completed" },
    { id: "b4", organization_id: "o2", status: "scheduled" },
  ];
  db.contact_broadcast_recipients = [
    { id: "r1", organization_id: "o1", broadcast_id: "b1", status: "pending" },
    { id: "r2", organization_id: "o1", broadcast_id: "b1", status: "sent" },
  ];
});

describe("cancelContactBroadcast (idempotente)", () => {
  it("annule une campagne programmée, saute les destinataires en attente, garde la trace", async () => {
    expect(await cancelContactBroadcast("o1", "b1", "u1")).toEqual({ result: "cancelled" });
    expect(db.contact_broadcasts![0]).toMatchObject({ status: "cancelled", cancelled_by: "u1" });
    expect(db.contact_broadcast_recipients!.map((r) => r.status)).toEqual(["skipped", "sent"]);
  });
  it("second appel : « déjà annulée », sans erreur", async () => {
    await cancelContactBroadcast("o1", "b1", "u1");
    expect(await cancelContactBroadcast("o1", "b1", "u1")).toEqual({ result: "already_cancelled" });
  });
  it("refuse honnêtement une campagne en cours ou terminée", async () => {
    await expect(cancelContactBroadcast("o1", "b2")).rejects.toThrow(/en cours/);
    await expect(cancelContactBroadcast("o1", "b3")).rejects.toThrow(/terminée/);
  });
  it("isolation entre tenants : la campagne d'une autre organisation est introuvable", async () => {
    await expect(cancelContactBroadcast("o1", "b4")).rejects.toThrow(/introuvable/);
    expect(db.contact_broadcasts![3]!.status).toBe("scheduled");
  });
});
