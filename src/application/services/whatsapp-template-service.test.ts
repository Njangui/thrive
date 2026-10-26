import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "../../../tests/helpers/fake-supabase";
import { applyTemplateStatusEvent, ensureTemplates, getTemplateStatuses, syncTemplates, type TemplateDeps } from "./whatsapp-template-service";

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("./notification-service", () => ({ notifyOrgAdmins: vi.fn() }));

const ORG = "org-1";
let db: FakeDb; let create: ReturnType<typeof vi.fn>; let list: ReturnType<typeof vi.fn>; let notify: ReturnType<typeof vi.fn>;
const deps = (): TemplateDeps => ({ db: db as unknown as SupabaseClient, client: { createWhatsAppTemplate: create, listWhatsAppTemplates: list } as unknown as TemplateDeps["client"], notifyAdmins: notify as unknown as TemplateDeps["notifyAdmins"] });

beforeEach(() => {
  db = new FakeDb();
  db.seed("whatsapp_accounts", [{ organization_id: ORG, account_id: "acc-1", status: "connected", is_primary: true }, { organization_id: "org-2", account_id: "acc-9", status: "connected", is_primary: true }]);
  create = vi.fn(async (i) => ({ id: `tpl-${i.name}`, name: i.name, status: "PENDING" })); list = vi.fn(async () => []); notify = vi.fn();
});

describe("ensureTemplates", () => {
  it("soumet les 3 modèles du catalogue au compte de l'entreprise, statut PENDING", async () => {
    const r = await ensureTemplates(ORG, deps(), "2026-10-09T10:00:00Z");
    expect(r).toMatchObject({ ok: true, submitted: ["alert", "approval_request", "daily_summary"], failed: [] });
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[0]![0]).toMatchObject({ accountId: "acc-1", name: "flexco_alerte_v1", category: "UTILITY", language: "fr" });
    expect((await getTemplateStatuses(ORG, db as unknown as SupabaseClient)).every((t) => t.status === "PENDING")).toBe(true);
  });
  it("idempotent : un modèle déjà soumis n'est pas recréé", async () => {
    await ensureTemplates(ORG, deps()); create.mockClear();
    await ensureTemplates(ORG, deps());
    expect(create).not.toHaveBeenCalled();
  });
  it("échec isolé : les autres partent, l'erreur est conservée, resoumission possible", async () => {
    create.mockImplementationOnce(async () => { throw new Error("Zernio createWhatsAppTemplate failed (400): nom invalide"); });
    const r = await ensureTemplates(ORG, deps());
    expect(r).toMatchObject({ ok: true, submitted: ["approval_request", "daily_summary"], failed: [{ key: "alert" }] });
    const alert = (await getTemplateStatuses(ORG, db as unknown as SupabaseClient)).find((t) => t.key === "alert")!;
    expect(alert).toMatchObject({ status: "NOT_SUBMITTED", reason: expect.stringContaining("nom invalide") });
    create.mockClear(); await ensureTemplates(ORG, deps());
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("sans numéro WhatsApp connecté : rien n'est envoyé", async () => {
    expect(await ensureTemplates("org-sans", deps())).toEqual({ ok: false, reason: "no_account" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("syncTemplates / webhook", () => {
  it("reprend l'état réel chez Meta (modèle APPROVED)", async () => {
    await ensureTemplates(ORG, deps());
    list.mockResolvedValue([{ id: "t1", name: "flexco_alerte_v1", language: "fr", status: "APPROVED" }, { name: "autre_modele", status: "APPROVED" }]);
    expect(await syncTemplates(ORG, deps())).toEqual({ ok: true, updated: 1 });
    expect(list).toHaveBeenCalledWith("acc-1");
    expect((await getTemplateStatuses(ORG, db as unknown as SupabaseClient)).find((t) => t.key === "alert")!.status).toBe("APPROVED");
  });
  it("événement avec nom : statut mis à jour ; REJECTED notifie les propriétaires avec la raison", async () => {
    await ensureTemplates(ORG, deps());
    expect(await applyTemplateStatusEvent(ORG, { name: "flexco_alerte_v1", status: "REJECTED", reason: "INVALID_FORMAT" }, deps())).toBe("updated");
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG, body: expect.stringContaining("INVALID_FORMAT") }));
    expect((await getTemplateStatuses(ORG, db as unknown as SupabaseClient)).find((t) => t.key === "alert")).toMatchObject({ status: "REJECTED", reason: "INVALID_FORMAT" });
  });
  it("APPROVED : raison « NONE » ignorée, pas de notification", async () => {
    await ensureTemplates(ORG, deps());
    await applyTemplateStatusEvent(ORG, { name: "flexco_bilan_v1", status: "APPROVED", reason: "NONE" }, deps());
    expect(notify).not.toHaveBeenCalled();
    expect((await getTemplateStatuses(ORG, db as unknown as SupabaseClient)).find((t) => t.key === "daily_summary")).toMatchObject({ status: "APPROVED", reason: null });
  });
  it("événement sans nom ni id (forme non confirmée) : resynchronisation plutôt qu'une devinette", async () => {
    await ensureTemplates(ORG, deps());
    list.mockResolvedValue([{ name: "flexco_validation_v1", language: "fr", status: "APPROVED" }]);
    expect(await applyTemplateStatusEvent(ORG, { status: "APPROVED" }, deps())).toBe("synced");
  });
  it("modèle étranger à Flexco : ignoré ; identifiant connu : retrouvé", async () => {
    await ensureTemplates(ORG, deps());
    expect(await applyTemplateStatusEvent(ORG, { name: "modele_du_commercant", status: "APPROVED" }, deps())).toBe("synced"); // pas dans le catalogue, sans id => resync
    expect(await applyTemplateStatusEvent(ORG, { id: "inconnu", status: "APPROVED" }, deps())).toBe("ignored");
    expect(await applyTemplateStatusEvent(ORG, { id: "tpl-flexco_alerte_v1", status: "PAUSED" }, deps())).toBe("updated");
  });
  it("isolation : les modèles d'une entreprise n'affectent pas une autre", async () => {
    await ensureTemplates(ORG, deps());
    expect((await getTemplateStatuses("org-2", db as unknown as SupabaseClient)).every((t) => t.status === "NOT_SUBMITTED")).toBe(true);
  });
});
