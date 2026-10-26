import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "../../../tests/helpers/fake-supabase";
import { createWhatsAppAlertPort, sendWhatsAppToMember, type SendDeps } from "./whatsapp-send-service";

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/infrastructure/providers/registry", () => ({ getMessagingProviderForChannel: vi.fn(), getEmailProvider: async () => ({}) }));
vi.mock("./notification-service", () => ({ notifyOrgAdmins: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.test" } }));

const ORG = "org-1", PHONE = "+237699000001";
const NOW = Date.parse("2026-10-09T12:00:00Z");
let db: FakeDb; let session: ReturnType<typeof vi.fn>; let start: ReturnType<typeof vi.fn>;
const deps = (): SendDeps => ({ db: db as unknown as SupabaseClient, now: () => NOW, sendSession: session as unknown as SendDeps["sendSession"], client: { startConversationWithTemplate: start } as unknown as SendDeps["client"] });
const identity = (over: Record<string, unknown> = {}) => ({ organization_id: ORG, channel: "whatsapp", external_id: PHONE, status: "active", last_inbound_at: "2026-10-09T08:00:00Z", whatsapp_conversation_id: "conv-1", whatsapp_account_id: "acc-1", ...over });
const approved = (status = "APPROVED") => db.seed("whatsapp_templates", [{ organization_id: ORG, template_key: "alert", status }]);
const input = { organizationId: ORG, e164: PHONE, text: "Rupture", template: { key: "alert" as const, values: ["Rupture\nde stock", "Savon"] } };

beforeEach(() => {
  db = new FakeDb(); session = vi.fn(async () => undefined); start = vi.fn(async () => ({ messageId: "m1" }));
  db.seed("whatsapp_accounts", [{ organization_id: ORG, account_id: "acc-fallback", status: "connected", is_primary: true }]);
});

describe("sendWhatsAppToMember", () => {
  it("fenêtre ouverte : message libre dans le fil, bouton lien, pas de modèle", async () => {
    db.seed("channel_identities", [identity()]);
    expect(await sendWhatsAppToMember({ ...input, button: { text: "Ouvrir", url: "https://app.test/x" } }, deps())).toEqual({ status: "sent", via: "session" });
    expect(session).toHaveBeenCalledWith(ORG, "acc-1", expect.objectContaining({ externalThreadId: "conv-1", content: "Rupture", buttons: [{ text: "Ouvrir", url: "https://app.test/x" }] }));
    expect(start).not.toHaveBeenCalled();
  });
  it("fenêtre fermée (> 24 h) + modèle APPROVED : modèle, participantId sans +, variables assainies", async () => {
    db.seed("channel_identities", [identity({ last_inbound_at: "2026-10-07T08:00:00Z" })]); approved();
    expect(await sendWhatsAppToMember(input, deps())).toEqual({ status: "sent", via: "template" });
    expect(session).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith({ accountId: "acc-1", participantId: "237699000001", templateName: "flexco_alerte_v1", templateLanguage: "fr", templateParams: ["Rupture de stock", "Savon"] });
  });
  it("jamais de fenêtre ouverte (aucun message reçu) : modèle", async () => {
    db.seed("channel_identities", [identity({ last_inbound_at: null, whatsapp_conversation_id: null, whatsapp_account_id: null })]); approved();
    await sendWhatsAppToMember(input, deps());
    expect(start.mock.calls[0]![0].accountId).toBe("acc-fallback");
  });
  it("hors fenêtre et modèle non approuvé / absent : skipped, RIEN n'est envoyé", async () => {
    db.seed("channel_identities", [identity({ last_inbound_at: null })]);
    expect(await sendWhatsAppToMember(input, deps())).toMatchObject({ status: "skipped", reason: expect.stringContaining("non approuvé") });
    approved("PENDING");
    expect(await sendWhatsAppToMember(input, deps())).toMatchObject({ status: "skipped" });
    expect(session).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  });
  it("hors fenêtre sans modèle prévu : skipped", async () => {
    db.seed("channel_identities", [identity({ last_inbound_at: null })]);
    expect(await sendWhatsAppToMember({ organizationId: ORG, e164: PHONE, text: "x" }, deps())).toMatchObject({ status: "skipped" });
  });
  it("envoi en fenêtre refusé par Meta : repli sur le modèle", async () => {
    db.seed("channel_identities", [identity()]); approved(); session.mockRejectedValue(new Error("131047"));
    expect(await sendWhatsAppToMember(input, deps())).toEqual({ status: "sent", via: "template" });
  });
  it("numéro non lié, révoqué ou d'une autre entreprise : skipped", async () => {
    db.seed("channel_identities", [identity({ status: "revoked" }), identity({ organization_id: "org-2" })]);
    expect(await sendWhatsAppToMember(input, deps())).toEqual({ status: "skipped", reason: "numéro non lié" });
  });
  it("échec réseau du modèle : failed avec raison, sans exception", async () => {
    db.seed("channel_identities", [identity({ last_inbound_at: null })]); approved(); start.mockRejectedValue(new Error("500"));
    expect(await sendWhatsAppToMember(input, deps())).toMatchObject({ status: "failed", reason: "500" });
  });
});

describe("port d'alerte", () => {
  it("texte d'alerte avec invitation à répondre VU et lien vers /dashboard/alerts", async () => {
    db.seed("channel_identities", [identity()]);
    const port = createWhatsAppAlertPort(deps(), "https://app.test");
    expect(await port.send({ organizationId: ORG, e164: PHONE, title: "Panne paiement", body: "Fapshi", alertId: "al-1" })).toBe("sent");
    const msg = session.mock.calls[0]![2];
    expect(msg.content).toContain("Répondez VU"); expect(msg.buttons[0].url).toBe("https://app.test/dashboard/alerts#al-1");
  });
});
