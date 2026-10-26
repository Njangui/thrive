import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Base en mémoire minimale (chaînage Supabase : select/update/eq/in/not/order/limit/maybeSingle) ---
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const cancelPost = vi.fn();

class Query {
  private op: "select" | "update" = "select";
  private patch: Row = {};
  private filters: Array<(r: Row) => boolean> = [];
  constructor(private table: string) {}
  select() { return this; }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); return this; }
  not(col: string, _op: string, val: unknown) { this.filters.push((r) => r[col] !== val); return this; }
  order() { return this; }
  limit() { return this; }
  private run() {
    const rows = (db[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") for (const r of rows) Object.assign(r, this.patch);
    return rows;
  }
  maybeSingle() { return Promise.resolve({ data: this.run()[0] ?? null, error: null }); }
  then(resolve: (v: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: this.run(), error: null }).then(resolve); }
}

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({ from: (t: string) => new Query(t) }) }));
vi.mock("@/infrastructure/providers/registry", () => ({ getSocialPublishingProvider: async () => ({ cancelPost }) }));

import {
  cancelScheduledPublication, cancelSocialPost, decideCancellation, isProviderNotFound,
  listScheduledPublications, parseFutureDate, rescheduleTelegramPublication,
} from "./publication-scheduling";

const ORG = "org-1";
const actor = { userId: "u1", organizationId: ORG };

beforeEach(() => {
  cancelPost.mockReset();
  for (const k of Object.keys(db)) delete db[k];
  db.memberships = [{ user_id: "u1", organization_id: ORG }];
  db.social_posts = [
    { id: "p-sched", organization_id: ORG, status: "scheduled", provider_post_id: "z1", content: "A", scheduled_for: "2030-01-02T10:00:00Z" },
    { id: "p-pub", organization_id: ORG, status: "published", provider_post_id: "z2", content: "B", scheduled_for: null },
    { id: "p-draft", organization_id: ORG, status: "draft", provider_post_id: null, content: "C", scheduled_for: null },
    { id: "p-other", organization_id: "org-2", status: "scheduled", provider_post_id: "z9", content: "X", scheduled_for: "2030-01-01T10:00:00Z" },
  ];
  db.social_post_targets = [{ id: "t1", organization_id: ORG, post_id: "p-sched", platform: "instagram", status: "pending" }];
  db.telegram_publications = [
    { id: "tg-sched", organization_id: ORG, status: "scheduled", content: "TG", target_label: "Canal", scheduled_for: "2030-01-01T09:00:00Z" },
    { id: "tg-proc", organization_id: ORG, status: "processing", content: "TG2", scheduled_for: "2030-01-01T08:00:00Z" },
  ];
});

describe("decideCancellation (pur)", () => {
  it("social : annulable si draft/scheduled/paused ; remote seulement si lié au fournisseur", () => {
    expect(decideCancellation("social", "scheduled", true).decision).toBe("cancel_remote");
    expect(decideCancellation("social", "draft", false).decision).toBe("cancel_local");
    expect(decideCancellation("social", "cancelled", true).decision).toBe("already_cancelled");
    expect(decideCancellation("social", "published", true).decision).toBe("refuse");
    expect(decideCancellation("social", "failed", true).decision).toBe("refuse");
  });
  it("telegram : seul `scheduled` est annulable, `processing` est refusé explicitement", () => {
    expect(decideCancellation("telegram", "scheduled", false).decision).toBe("cancel_local");
    expect(decideCancellation("telegram", "processing", false).reason).toMatch(/en cours/);
    expect(decideCancellation("telegram", "published", false).decision).toBe("refuse");
  });
  it("détecte un 404 fournisseur", () => {
    expect(isProviderNotFound(new Error("Zernio deletePost failed (404): Not found"))).toBe(true);
    expect(isProviderNotFound(new Error("Zernio deletePost failed (500): boom"))).toBe(false);
  });
});

describe("annulation d'une publication sociale (Zernio)", () => {
  it("annule chez le fournisseur puis en base, et la cible passe à cancelled", async () => {
    cancelPost.mockResolvedValue(undefined);
    expect(await cancelSocialPost(actor, "p-sched")).toEqual({ id: "p-sched", kind: "social", result: "cancelled" });
    expect(cancelPost).toHaveBeenCalledWith("z1");
    expect(db.social_posts![0]).toMatchObject({ status: "cancelled", cancelled_by: "u1" });
    expect(db.social_post_targets![0]!.status).toBe("cancelled");
  });
  it("est idempotente : un second appel ne rappelle pas le fournisseur", async () => {
    cancelPost.mockResolvedValue(undefined);
    await cancelSocialPost(actor, "p-sched");
    expect(await cancelSocialPost(actor, "p-sched")).toMatchObject({ result: "already_cancelled" });
    expect(cancelPost).toHaveBeenCalledTimes(1);
  });
  it("échec fournisseur : le statut RESTE scheduled (jamais un faux « annulé ») et la trace est gardée", async () => {
    cancelPost.mockRejectedValue(new Error("Zernio deletePost failed (500): boom"));
    await expect(cancelSocialPost(actor, "p-sched")).rejects.toThrow(/n'a pas pu être confirmée/);
    expect(db.social_posts![0]!.status).toBe("scheduled");
    expect(String(db.social_posts![0]!.error_message)).toMatch(/non confirmée/);
    expect(db.social_post_targets![0]!.status).toBe("pending");
  });
  it("404 fournisseur : considéré comme déjà supprimé, on annule en base", async () => {
    cancelPost.mockRejectedValue(new Error("Zernio deletePost failed (404): Not found"));
    expect(await cancelSocialPost(actor, "p-sched")).toMatchObject({ result: "cancelled" });
  });
  it("refuse une publication déjà publiée, sans appel fournisseur", async () => {
    await expect(cancelSocialPost(actor, "p-pub")).rejects.toThrow(/déjà diffusée/);
    expect(cancelPost).not.toHaveBeenCalled();
  });
  it("brouillon jamais transmis : annulation locale, sans appel fournisseur", async () => {
    expect(await cancelSocialPost(actor, "p-draft")).toMatchObject({ result: "cancelled" });
    expect(cancelPost).not.toHaveBeenCalled();
  });
  it("isolation : un post d'une autre organisation est introuvable", async () => {
    await expect(cancelSocialPost(actor, "p-other")).rejects.toThrow(/introuvable/);
    expect(cancelPost).not.toHaveBeenCalled();
  });
  it("un acteur qui n'est pas membre est refusé avant toute lecture", async () => {
    await expect(cancelSocialPost({ userId: "intrus", organizationId: ORG }, "p-sched")).rejects.toThrow(/n'appartenez pas/);
  });
});

describe("annulation d'une publication Telegram (canal direct, hors Zernio)", () => {
  it("annule par simple changement de statut, sans jamais appeler Zernio", async () => {
    expect(await cancelScheduledPublication(actor, { kind: "telegram", id: "tg-sched" })).toMatchObject({ result: "cancelled" });
    expect(db.telegram_publications![0]).toMatchObject({ status: "cancelled", cancelled_by: "u1" });
    expect(cancelPost).not.toHaveBeenCalled();
  });
  it("idempotente ; refuse un envoi déjà en cours", async () => {
    await cancelScheduledPublication(actor, { kind: "telegram", id: "tg-sched" });
    expect(await cancelScheduledPublication(actor, { kind: "telegram", id: "tg-sched" })).toMatchObject({ result: "already_cancelled" });
    await expect(cancelScheduledPublication(actor, { kind: "telegram", id: "tg-proc" })).rejects.toThrow(/en cours/);
  });
});

describe("reprogrammation et listage", () => {
  it("reprogramme une publication Telegram programmée ; refuse une date passée", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(await rescheduleTelegramPublication(actor, "tg-sched", future)).toMatchObject({ id: "tg-sched", scheduledFor: future });
    expect(db.telegram_publications![0]!.scheduled_for).toBe(future);
    await expect(rescheduleTelegramPublication(actor, "tg-sched", "2020-01-01T00:00:00Z")).rejects.toThrow(/futures/);
    await expect(rescheduleTelegramPublication(actor, "tg-proc", future)).rejects.toThrow(/déjà traitée/);
  });
  it("parseFutureDate rejette une date invalide", () => {
    expect(() => parseFutureDate("pas une date")).toThrow(/futures/);
  });
  it("liste les programmées de l'organisation (réseaux + Telegram), triées par date, sans fuite entre tenants", async () => {
    const items = await listScheduledPublications(actor);
    expect(items.map((i) => i.id)).toEqual(["tg-sched", "p-sched"]);
    expect(items.some((i) => i.id === "p-other")).toBe(false);
    expect(items[0]).toMatchObject({ kind: "telegram", platform: "telegram", label: "Canal" });
  });
});
