import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

/* ---- Mini base en mémoire (juste ce que le service utilise) : colonnes, triggers de numérotation, unicité du brouillon, cascade ---- */
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let rpcPublish = true;

class Query {
  private filters: Array<(r: Row) => boolean> = [];
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row = {};
  private ordering: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private rangeN: [number, number] | null = null;
  private count = false;
  private head = false;
  private returning = false;
  constructor(private table: string) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (this.op !== "select") this.returning = true; if (opts?.count) this.count = true; if (opts?.head) this.head = true; return this; }
  insert(p: Row) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, v: unknown[]) { this.filters.push((r) => v.includes(r[c])); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.ordering = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.limitN = n; return this; }
  range(a: number, b: number) { this.rangeN = [a, b]; return this; }
  single() { return this.run(true, true); }
  maybeSingle() { return this.run(false, true); }
  then(onOk?: (v: Awaited<ReturnType<Query["run"]>>) => unknown, onErr?: (e: unknown) => unknown) { return this.run(false, false).then(onOk, onErr); }

  private async run(mustExist: boolean, one: boolean) {
    const rows = (tables[this.table] ??= []);
    const match = () => rows.filter((r) => this.filters.every((f) => f(r)));
    let out: Row[] = [];
    if (this.op === "insert") {
      const row: Row = { id: randomUUID(), created_at: new Date(Date.now() + rows.length).toISOString(), ...this.payload };
      if (this.table === "site_versions") {
        if (row.status === "draft" && rows.some((r) => r.organization_id === row.organization_id && r.status === "draft")) return { data: null, error: { message: "duplicate", code: "23505" } };
        row.version_number = Math.max(0, ...rows.filter((r) => r.organization_id === row.organization_id).map((r) => r.version_number as number)) + 1;
      }
      if (this.table === "site_revisions") row.revision_number = Math.max(0, ...rows.filter((r) => r.version_id === row.version_id).map((r) => r.revision_number as number)) + 1;
      rows.push(row);
      out = [row];
    } else if (this.op === "update") {
      out = match();
      if (this.table === "site_revisions" && out.length) return { data: null, error: { message: "Une révision du site est immuable" } };
      out.forEach((r) => Object.assign(r, this.payload));
    } else if (this.op === "delete") {
      out = match();
      tables[this.table] = rows.filter((r) => !out.includes(r));
      if (this.table === "site_versions") tables.site_revisions = (tables.site_revisions ?? []).filter((r) => !out.some((v) => v.id === r.version_id));
    } else {
      out = match();
      if (this.ordering) { const { col, asc } = this.ordering; out = [...out].sort((a, b) => ((a[col] as number) - (b[col] as number)) * (asc ? 1 : -1)); }
      if (this.rangeN) out = out.slice(this.rangeN[0], this.rangeN[1] + 1);
      if (this.limitN !== null) out = out.slice(0, this.limitN);
    }
    const returnsRows = this.op === "select" || this.returning;
    if (this.head) return { data: null, error: null, count: out.length };
    if (!returnsRows) return { data: null, error: null };
    if (one) {
      if (out.length === 0) return mustExist ? { data: null, error: { message: "no rows" } } : { data: null, error: null };
      return { data: out[0], error: null };
    }
    return { data: out, error: null, ...(this.count ? { count: out.length } : {}) };
  }
}

const fakeClient = {
  from: (t: string) => new Query(t),
  rpc: async (name: string, a: { p_organization_id: string; p_version_id: string; p_user_id: string }) => {
    if (name !== "publish_site_version" || !rpcPublish) return { error: { message: "rpc indisponible" } };
    const vs = tables.site_versions ?? [];
    vs.filter((v) => v.organization_id === a.p_organization_id && v.status === "published").forEach((v) => { v.status = "archived"; });
    const target = vs.find((v) => v.id === a.p_version_id)!;
    target.status = "published"; target.published_at = new Date().toISOString();
    return { error: null };
  },
};

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => fakeClient }));
vi.mock("./auth-service", () => ({ requireMembership: async () => ({ userId: "u1", role: "owner" }) }));
vi.mock("./site-permissions", () => ({ requireSiteEditor: async () => ({ userId: "u1", role: "owner" }), requireSitePublisher: async () => ({ userId: "u1", role: "owner" }) }));
vi.mock("./landing-config-service", () => ({
  getLandingConfig: async () => ({
    sections: [{ type: "hero", enabled: true, order: 0 }, { type: "products", enabled: true, order: 1 }, { type: "contact", enabled: true, order: 2 }],
    brandColorPrimary: null, brandColorSecondary: null, fontChoice: "modern", visualStyle: "soft", heroTitle: "Boutique Akwa", heroSubtitle: "Tout pour la maison", ctaLabel: "Voir", ctaUrl: "/produits",
    secondaryCtaLabel: null, heroLayout: null, heroMediaUrl: null, announcement: null, announcementEnabled: true, highlights: null,
  }),
}));

const ORG = "org-1";
const svc = () => import("./site-version-service");

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.organizations = [{ id: ORG, name: "Boutique Akwa", description: null }];
  rpcPublish = true;
});

describe("historique fin du brouillon", () => {
  it("la première modification garde l'état de départ puis une étape par modification", async () => {
    const s = await svc();
    await s.editDraftCore(ORG, "u1", [{ op: "set_theme", theme: { visualStyle: "bold" } }], { source: "agent" });
    await s.editDraftCore(ORG, "u1", [{ op: "set_announcement", announcement: { text: "Soldes", enabled: true } }], { source: "agent" });
    const steps = await s.listDraftRevisionsCore(ORG);
    expect(steps.map((r) => [r.revisionNumber, r.source])).toEqual([[3, "agent"], [2, "agent"], [1, "baseline"]]);
    expect(steps[0]!.summary).toContain("Barre d'annonce");
  });

  it("revenir à une étape remet le brouillon dans cet état et crée une nouvelle étape (annulable)", async () => {
    const s = await svc();
    await s.editDraftCore(ORG, "u1", [{ op: "set_theme", theme: { visualStyle: "bold" } }], { source: "agent" });
    await s.editDraftCore(ORG, "u1", [{ op: "set_theme", theme: { visualStyle: "clean" } }], { source: "agent" });
    const before = await s.listDraftRevisionsCore(ORG);
    const bold = before.find((r) => r.revisionNumber === 2)!;
    const { version, revisionNumber } = await s.revertDraftCore(ORG, "u1", bold.id);
    expect(revisionNumber).toBe(2);
    expect(version.snapshot.theme.visualStyle).toBe("bold");
    const after = await s.listDraftRevisionsCore(ORG);
    expect(after[0]).toMatchObject({ revisionNumber: 4, source: "revert" });
    // et le retour lui-même est annulable : on retrouve « clean »
    const clean = after.find((r) => r.revisionNumber === 3)!;
    expect((await s.revertDraftCore(ORG, "u1", clean.id)).version.snapshot.theme.visualStyle).toBe("clean");
  });

  it("refuse l'étape d'un autre tenant ou d'une autre version, et un identifiant inconnu", async () => {
    const s = await svc();
    await s.editDraftCore(ORG, "u1", [{ op: "set_theme", theme: { visualStyle: "bold" } }], { source: "agent" });
    const [rev] = await s.listDraftRevisionsCore(ORG);
    await expect(s.revertDraftCore("org-2", "u1", rev!.id)).rejects.toThrow(/Aucun brouillon/);
    // la même étape, vue depuis une autre organisation qui a son propre brouillon
    tables.organizations!.push({ id: "org-2", name: "Autre" });
    await s.editDraftCore("org-2", "u2", [{ op: "set_theme", theme: { visualStyle: "clean" } }], { source: "agent" });
    await expect(s.revertDraftCore("org-2", "u2", rev!.id)).rejects.toThrow(/introuvable/);
    await expect(s.revertDraftCore(ORG, "u1", randomUUID())).rejects.toThrow(/introuvable/);
  });

  it("une modification invalide ne laisse AUCUNE trace (ni brouillon modifié ni étape)", async () => {
    const s = await svc();
    await s.editDraftCore(ORG, "u1", [{ op: "set_theme", theme: { visualStyle: "bold" } }], { source: "agent" });
    const n = (await s.listDraftRevisionsCore(ORG)).length;
    await expect(s.editDraftCore(ORG, "u1", [{ op: "add_page", title: "Ok", slug: "ok" }, { op: "remove_page", pageId: "inconnue" }], { source: "agent" })).rejects.toThrow(/introuvable/);
    expect((await s.listDraftRevisionsCore(ORG)).length).toBe(n);
    expect((await s.getSiteDraftCore(ORG))!.snapshot.pages.map((p) => p.slug)).toEqual([""]);
  });

  it("n'en garde que 100 par version (les plus anciennes sont élaguées)", async () => {
    const s = await svc();
    for (let i = 0; i < 104; i++) {
      await s.editDraftCore(ORG, "u1", [{ op: "set_announcement", announcement: { text: `Annonce ${i}`, enabled: true } }], { source: "manual" });
    }
    const steps = await s.listDraftRevisionsCore(ORG, 100);
    expect(steps.length).toBe(100);
    expect(steps[0]!.revisionNumber).toBe(105);
    expect((tables.site_revisions ?? []).length).toBe(100);
  });

  it("publier, puis revenir à l'ancienne version publiée en brouillon, reste possible et l'historique fin suit chaque brouillon", async () => {
    const s = await svc();
    await s.editDraftCore(ORG, "u1", [{ op: "set_mode", mode: "free" }], { source: "agent" });
    const published = await s.publishDraftCore(ORG, "u1");
    expect(published.versionNumber).toBe(1);
    await s.editDraftCore(ORG, "u1", [{ op: "set_theme", theme: { visualStyle: "bold" } }], { source: "agent" });
    await s.publishDraftCore(ORG, "u1");
    const versions = await s.listSiteVersionsCore(ORG);
    expect(versions.map((v) => [v.versionNumber, v.status])).toEqual([[2, "published"], [1, "archived"]]);
    const restored = await s.restoreVersionCore(ORG, "u1", versions[1]!.id);
    expect(restored.status).toBe("draft");
    expect(restored.snapshot.theme.visualStyle).toBe("soft");
    // le brouillon restauré a son propre historique, vide au départ
    expect(await s.listDraftRevisionsCore(ORG)).toEqual([]);
  });

  it("restaurer avec un brouillon en cours exige de confirmer son abandon", async () => {
    const s = await svc();
    await s.editDraftCore(ORG, "u1", [{ op: "set_theme", theme: { visualStyle: "bold" } }], { source: "agent" });
    await s.publishDraftCore(ORG, "u1");
    await s.editDraftCore(ORG, "u1", [{ op: "set_theme", theme: { visualStyle: "clean" } }], { source: "agent" });
    const v1 = (await s.listSiteVersionsCore(ORG)).find((v) => v.status === "published")!;
    await expect(s.restoreVersionCore(ORG, "u1", v1.id)).rejects.toThrow(/brouillon est en cours/);
    await expect(s.restoreVersionCore(ORG, "u1", v1.id, { discardDraft: true })).resolves.toMatchObject({ status: "draft" });
  });

  it("la publication est bloquée par une erreur SEO critique", async () => {
    const s = await svc();
    await s.editDraftCore(ORG, "u1", [{ op: "set_page_seo", pageId: (await s.getSiteDraftCore(ORG) ?? (await s.ensureDraftCore(ORG, "u1"))).snapshot.pages[0]!.id, seo: { noindex: true } }], { source: "agent" });
    await expect(s.publishDraftCore(ORG, "u1")).rejects.toThrow(/Publication bloquée/);
    expect((tables.site_versions ?? []).some((v) => v.status === "published")).toBe(false);
  });
});
