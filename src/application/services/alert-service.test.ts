import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "../../../tests/helpers/fake-supabase";
import { acknowledgeAlert, notify, processDueAlerts, raiseAlert, registerAlertWhatsApp, saveAlertSettings, type AlertDeps } from "./alert-service";

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/infrastructure/providers/registry", () => ({ getEmailProvider: async () => ({}) }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.test" } }));

const M3 = "00000000-0000-4000-8000-0000000000m3".replace("m3", "03"), ORG = "org-1", OTHER = "org-2";
const MIN = 60_000;
let db: FakeDb; let now: number;
let push: ReturnType<typeof vi.fn>; let tgSend: ReturnType<typeof vi.fn>; let emailSend: ReturnType<typeof vi.fn>;
let waSend: ReturnType<typeof vi.fn>;

const deps = (over: Partial<AlertDeps> = {}): AlertDeps => ({
  db: db as unknown as SupabaseClient,
  push: push as unknown as AlertDeps["push"],
  telegram: { sendMessage: tgSend } as unknown as AlertDeps["telegram"],
  email: { send: emailSend as unknown as (a: string, b: string, c: string) => Promise<boolean> },
  getEmail: async (u) => `${u}@x.test`,
  whatsapp: () => ({ send: waSend as unknown as (i: never) => Promise<"sent" | "failed" | "skipped"> }),
  now: () => now,
  appUrl: "https://app.test",
  ...over,
});

beforeEach(() => {
  now = Date.UTC(2026, 9, 9, 12, 0); // 13:00 à Douala
  db = new FakeDb();
  db.uniques.alerts = [{ cols: ["organization_id", "dedupe_key"], where: (r) => r.status === "held" || r.status === "open" }];
  db.defaults.alerts = { status: "open", escalation_step: 0 };
  db.seed("organizations", [{ id: ORG, timezone: "Africa/Douala" }, { id: OTHER, timezone: "Africa/Douala" }]);
  db.seed("memberships", [
    { id: "m1", organization_id: ORG, user_id: "u1", role: "owner" },
    { id: "m2", organization_id: ORG, user_id: "u2", role: "admin" },
    { id: M3, organization_id: ORG, user_id: "u3", role: "employee" },
    { id: "m9", organization_id: OTHER, user_id: "u9", role: "owner" },
  ]);
  db.seed("channel_identities", [
    { organization_id: ORG, membership_id: "m1", channel: "telegram", external_id: "111", status: "active" },
    { organization_id: ORG, membership_id: M3, channel: "telegram", external_id: "333", status: "active" },
    { organization_id: ORG, membership_id: "m2", channel: "telegram", external_id: "222", status: "revoked" },
    { organization_id: ORG, membership_id: "m1", channel: "whatsapp", external_id: "+237600000001", status: "pending" },
  ]);
  push = vi.fn(async () => 1); tgSend = vi.fn(async () => ({ message_id: 1 })); emailSend = vi.fn(async () => true); waSend = vi.fn(async () => "sent");
  registerAlertWhatsApp(null);
});

const alertsOf = () => db.rows("alerts");
const raise = (over: Record<string, unknown> = {}) => raiseAlert({ organizationId: ORG, trigger: "outage", title: "Paiement en panne", body: "Fapshi ne répond plus", ...over } as never, deps());

describe("raiseAlert", () => {
  it("crée l'alerte, notifie les propriétaires (in-app + push) et planifie l'escalade", async () => {
    const r = await raise();
    expect(r).toMatchObject({ status: "created", held: false });
    expect(push).toHaveBeenCalledWith(ORG, ["u1", "u2"], expect.stringContaining("Paiement en panne"), "Fapshi ne répond plus", "/dashboard/alerts", { urgency: "high" });
    expect(db.rows("notifications").map((n) => n.recipient_user_id)).toEqual(["u1", "u2"]);
    expect(alertsOf()[0]).toMatchObject({ status: "open", next_escalation_at: new Date(now + 15 * MIN).toISOString() });
    expect(tgSend).not.toHaveBeenCalled(); // Telegram seulement au palier 1
  });
  it("aucun appareil push atteint => escalade immédiate", async () => {
    push.mockResolvedValue(0);
    await raise();
    expect(alertsOf()[0]!.next_escalation_at).toBe(new Date(now).toISOString());
  });
  it("déduplique tant que l'alerte est vivante, ré-autorise après accusé", async () => {
    expect((await raise({ dedupeKey: "k" })).status).toBe("created");
    expect((await raise({ dedupeKey: "k" })).status).toBe("duplicate");
    await acknowledgeAlert({ alertId: alertsOf()[0]!.id as string, organizationId: ORG, membershipId: "m1", via: "dashboard" }, deps());
    expect((await raise({ dedupeKey: "k" })).status).toBe("created");
  });
  it("déclencheur désactivé / sous le seuil / inconnu", async () => {
    expect((await raise({ trigger: "ad_spend_anomaly" })).status).toBe("disabled");
    await saveAlertSettings(ORG, { triggers: { refund_over_threshold: { enabled: true, threshold: 50000 } } }, db as unknown as SupabaseClient);
    expect((await raise({ trigger: "refund_over_threshold", value: 49000 })).status).toBe("below_threshold");
    expect((await raise({ trigger: "refund_over_threshold", value: 50000 })).status).toBe("created");
    await expect(raise({ trigger: "nope" })).rejects.toThrow(/inconnu/);
  });
  it("heures calmes : retenue, sauf critique", async () => {
    await saveAlertSettings(ORG, { quietEnabled: true, quietStart: "22:00", quietEnd: "07:00" }, db as unknown as SupabaseClient);
    now = Date.UTC(2026, 9, 9, 22, 0); // 23:00 à Douala
    const held = await raise({ trigger: "top_product_stockout", title: "Rupture" });
    expect(held).toMatchObject({ status: "created", held: true });
    expect(push).not.toHaveBeenCalled();
    expect(alertsOf()[0]).toMatchObject({ status: "held", release_at: "2026-10-10T06:00:00.000Z" });
    const crit = await raise({ trigger: "outage" });
    expect(crit).toMatchObject({ held: false });
    expect(push).toHaveBeenCalledTimes(1);
  });
  it("info : un seul push, jamais d'escalade", async () => {
    await raise({ severity: "info" });
    expect(push.mock.calls[0]![5]).toEqual({ urgency: "normal" });
    expect(alertsOf()[0]!.next_escalation_at).toBeNull();
  });
  it("isolation : un autre tenant n'est jamais notifié", async () => {
    await raise();
    expect(db.rows("notifications").some((n) => n.organization_id === OTHER)).toBe(false);
    expect(push.mock.calls[0]![1]).not.toContain("u9");
  });
});

describe("processDueAlerts — escalade", () => {
  it("rien avant l'échéance", async () => {
    await raise(); now += 14 * MIN;
    expect(await processDueAlerts(deps())).toEqual({ released: 0, escalated: 0, expired: 0 });
  });
  it("palier 1 : Telegram des propriétaires LIÉS et ACTIFS + email, bouton d'accusé ; WhatsApp non configuré = skipped", async () => {
    await raise(); now += 15 * MIN;
    expect(await processDueAlerts(deps())).toMatchObject({ escalated: 1 });
    expect(tgSend).toHaveBeenCalledTimes(1); // m1 seulement : m2 révoqué, m3 non propriétaire
    const call = tgSend.mock.calls[0]![0];
    expect(call.chat_id).toBe(111);
    expect(call.reply_markup.inline_keyboard[0][0].callback_data).toBe(`al:a:${alertsOf()[0]!.id}`);
    expect(call.parse_mode).toBeUndefined();
    expect(emailSend).toHaveBeenCalledTimes(2);
    const wa = db.rows("alert_deliveries").filter((d) => d.channel === "whatsapp");
    expect(wa).toHaveLength(1); expect(wa[0]).toMatchObject({ status: "skipped" }); // identité 'pending' : exclue, donc « aucun WhatsApp lié »
    expect(alertsOf()[0]).toMatchObject({ escalation_step: 1 });
  });
  it("sans personne de repli le palier 2 est sauté puis l'alerte expire", async () => {
    await raise(); now += 15 * MIN; await processDueAlerts(deps());
    now += 15 * MIN;
    expect(await processDueAlerts(deps())).toMatchObject({ expired: 1 });
    expect(alertsOf()[0]).toMatchObject({ status: "expired", escalation_step: 3 });
  });
  it("palier 2 : personne de repli (tous canaux) puis expiration", async () => {
    await saveAlertSettings(ORG, { fallbackMembershipId: M3, escalationDelayMinutes: 10 }, db as unknown as SupabaseClient);
    await raise(); now += 10 * MIN; await processDueAlerts(deps());
    tgSend.mockClear(); push.mockClear();
    now += 10 * MIN;
    expect(await processDueAlerts(deps())).toMatchObject({ escalated: 1 });
    expect(push).toHaveBeenCalledWith(ORG, ["u3"], expect.anything(), expect.anything(), expect.anything(), expect.anything());
    expect(tgSend.mock.calls[0]![0].chat_id).toBe(333);
    now += 10 * MIN;
    expect(await processDueAlerts(deps())).toMatchObject({ expired: 1 });
  });
  it("l'accusé stoppe l'escalade", async () => {
    await raise(); const id = alertsOf()[0]!.id as string;
    expect(await acknowledgeAlert({ alertId: id, organizationId: ORG, membershipId: "m2", via: "telegram" }, deps())).toEqual({ ok: true, alreadyDone: false });
    now += 60 * MIN;
    expect(await processDueAlerts(deps())).toEqual({ released: 0, escalated: 0, expired: 0 });
    expect(alertsOf()[0]).toMatchObject({ status: "acknowledged", acknowledged_by: "m2", acknowledged_via: "telegram" });
  });
  it("deux passes concurrentes : un seul envoi par palier (réclamation atomique)", async () => {
    await raise(); now += 15 * MIN;
    const [a, b] = await Promise.all([processDueAlerts(deps()), processDueAlerts(deps())]);
    expect(a.escalated + b.escalated).toBe(1);
    expect(tgSend).toHaveBeenCalledTimes(1);
  });
  it("relâche les alertes retenues à la fin des heures calmes", async () => {
    await saveAlertSettings(ORG, { quietEnabled: true }, db as unknown as SupabaseClient);
    now = Date.UTC(2026, 9, 9, 22, 0);
    await raise({ trigger: "top_product_stockout" });
    now = Date.UTC(2026, 9, 10, 5, 59);
    expect((await processDueAlerts(deps())).released).toBe(0);
    now = Date.UTC(2026, 9, 10, 6, 0);
    expect((await processDueAlerts(deps())).released).toBe(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(alertsOf()[0]).toMatchObject({ status: "open" });
  });
});

describe("notify", () => {
  const base = { organizationId: ORG, alertId: "a1", step: 1 as const, severity: "important" as const, title: "T", body: "B" };
  it("échec Telegram isolé, journalisé, n'empêche pas l'email", async () => {
    tgSend.mockRejectedValue(new Error("403 bot bloqué"));
    const r = await notify({ ...base, recipients: [{ id: "m1", userId: "u1" }], channels: ["telegram", "email"] }, deps());
    expect(r.delivered).toEqual({ email: 1 });
    expect(db.rows("alert_deliveries").find((d) => d.channel === "telegram")).toMatchObject({ status: "failed", reason: "403 bot bloqué" });
  });
  it("WhatsApp via le port enregistré (identité active uniquement)", async () => {
    db.seed("channel_identities", [{ organization_id: ORG, membership_id: "m2", channel: "whatsapp", external_id: "+237600000002", status: "active" }]);
    const r = await notify({ ...base, recipients: [{ id: "m1", userId: "u1" }, { id: "m2", userId: "u2" }], channels: ["whatsapp"] }, deps());
    expect(waSend).toHaveBeenCalledTimes(1);
    expect(waSend.mock.calls[0]![0]).toMatchObject({ e164: "+237600000002" });
    expect(r.delivered.whatsapp).toBe(1);
  });
  it("email : HTML échappé (le texte peut citer un client)", async () => {
    await notify({ ...base, title: "<b>x</b>", body: "<script>1</script>", recipients: [{ id: "m1", userId: "u1" }], channels: ["email"] }, deps());
    const html = emailSend.mock.calls[0]![2] as string;
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
  });
  it("lien relatif uniquement (pas de redirection ouverte)", async () => {
    await notify({ ...base, url: "//evil.test/x", recipients: [{ id: "m1", userId: "u1" }], channels: ["telegram"] }, deps());
    expect(tgSend.mock.calls[0]![0].text).toContain("https://app.test/dashboard/alerts");
    expect(tgSend.mock.calls[0]![0].text).not.toContain("evil");
  });
});

describe("acknowledgeAlert / saveAlertSettings", () => {
  it("refuse un employé non repli, un autre tenant, une alerte inconnue", async () => {
    await raise(); const id = alertsOf()[0]!.id as string;
    expect(await acknowledgeAlert({ alertId: id, organizationId: ORG, membershipId: M3, via: "dashboard" }, deps())).toEqual({ ok: false, reason: "forbidden" });
    expect(await acknowledgeAlert({ alertId: id, organizationId: OTHER, membershipId: "m9", via: "dashboard" }, deps())).toEqual({ ok: false, reason: "not_found" });
    expect(await acknowledgeAlert({ alertId: "zz", organizationId: ORG, membershipId: "m1", via: "dashboard" }, deps())).toEqual({ ok: false, reason: "not_found" });
  });
  it("la personne de repli peut accuser ; second accusé idempotent", async () => {
    await saveAlertSettings(ORG, { fallbackMembershipId: M3 }, db as unknown as SupabaseClient);
    await raise(); const id = alertsOf()[0]!.id as string;
    expect(await acknowledgeAlert({ alertId: id, organizationId: ORG, membershipId: M3, via: "dashboard" }, deps())).toEqual({ ok: true, alreadyDone: false });
    expect(await acknowledgeAlert({ alertId: id, organizationId: ORG, membershipId: "m1", via: "dashboard" }, deps())).toEqual({ ok: true, alreadyDone: true });
  });
  it("réglages : repli d'un autre tenant et valeurs invalides refusés", async () => {
    await expect(saveAlertSettings(ORG, { fallbackMembershipId: "00000000-0000-4000-8000-0000000000aa" }, db as unknown as SupabaseClient)).rejects.toThrow(/repli/);
    await expect(saveAlertSettings(ORG, { escalationDelayMinutes: 0 }, db as unknown as SupabaseClient)).rejects.toThrow();
  });
});
