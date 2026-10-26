import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "../../../tests/helpers/fake-supabase";
import { handleWhatsAppBackoffice, type WhatsAppBackofficeDeps, type WhatsAppInbound } from "./whatsapp-backoffice-service";
import type { AgentEvent, AgentRuntimePort, ApprovalCard } from "@/domain/ports/agent-runtime-port";
import type { StepUpPort } from "@/domain/ports/step-up-port";
import type { OutboundMessage } from "@/domain/ports/messaging-provider";
import type { RateLimitKind } from "@/lib/rate-limit";

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/infrastructure/providers/registry", () => ({ getMessagingProviderForChannel: vi.fn(), getEmailProvider: async () => ({}) }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.test" } }));

const NOW = Date.parse("2026-10-09T10:00:00Z");
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHONE = "+237699000001";
let db: FakeDb; let replies: OutboundMessage[]; let runtimeEvents: AgentEvent[]; let runtimeActors: unknown[]; let runtimeTexts: string[]; let limits: Partial<Record<RateLimitKind, number | null>>;
let consume: ReturnType<typeof vi.fn>;

const card = (over: Partial<ApprovalCard> = {}): ApprovalCard => ({
  pendingActionId: "pa-1", tool: "orders.refund", title: "Rembourser #12", summary: "5 000 FCFA", risk: "sensitive",
  details: [{ label: "Montant", value: "5 000 FCFA" }], expiresAt: new Date(NOW + 600_000).toISOString(),
  stepUp: { challengeId: "ch-1", allowedMethods: ["pin", "dashboard_link"], linkToken: "tok-1" }, ...over,
});

function deps(): WhatsAppBackofficeDeps {
  const runtime: AgentRuntimePort = {
    name: "fake",
    async *run(input) { runtimeActors.push(input.actor); runtimeTexts.push(input.text); for (const e of runtimeEvents) yield e; },
    async decideApproval() { throw new Error("jamais appelé depuis WhatsApp"); },
    async listVisibleTools() { return []; },
  };
  return {
    db: db as unknown as SupabaseClient,
    chat: { db: db as unknown as SupabaseClient, runtime, stepUp: {} as StepUpPort, rateLimit: async () => null, now: () => NOW },
    rateLimit: async (k) => limits[k] ?? null, now: () => NOW, appUrl: "https://app.test",
    reply: async (_o, _a, m) => { replies.push(m); },
  };
}
const msg = (text: string, over: Partial<WhatsAppInbound> = {}): WhatsAppInbound => ({ organizationId: ORG, accountId: "acc-1", conversationId: "conv-1", phoneE164: PHONE, text, hasAttachment: false, ...over });
const identity = (over: Record<string, unknown> = {}) => ({ id: "idn-1", organization_id: ORG, membership_id: "mem-1", user_id: "user-1", channel: "whatsapp", external_id: PHONE, status: "active", memberships: { role: "owner", extra_permissions: {} }, organizations: { status: "active", name: "Boutique" }, ...over });
const enable = (over: Record<string, unknown> = {}) => db.seed("whatsapp_backoffice_settings", [{ organization_id: ORG, enabled: true, dedicated_account_id: null, ...over }]);

beforeEach(() => {
  db = new FakeDb();
  db.defaults.assistant_messages = { status: "complete", parts: [] };
  db.defaults.assistant_threads = { last_message_at: "2026-01-01T00:00:00.000Z", title: null, archived_at: null };
  replies = []; runtimeActors = []; runtimeTexts = []; limits = {}; consume = vi.fn();
  runtimeEvents = [{ type: "text_delta", text: "Stock : 12." }, { type: "done" }];
  db.rpcHandlers.consume_channel_link_code = (a) => (consume as unknown as (x: unknown) => never)(a);
  db.rpcHandlers.revoke_channel_identity = (a) => { const r = db.rows("channel_identities").find((x) => x.id === a.p_identity_id); if (!r || r.status === "revoked") return { data: false, error: null }; r.status = "revoked"; return { data: true, error: null }; };
});

describe("routage", () => {
  it("back-office désactivé : tout est rendu au pipeline client, même un membre lié", async () => {
    db.seed("channel_identities", [identity()]);
    expect(await handleWhatsAppBackoffice(msg("stock ?"), deps())).toBe("not_backoffice");
    expect(replies).toHaveLength(0); expect(runtimeActors).toHaveLength(0);
  });
  it("mode partagé : numéro non lié => client ; numéro lié => agent avec l'acteur résolu (rôle relu)", async () => {
    enable();
    expect(await handleWhatsAppBackoffice(msg("bonjour", { phoneE164: "+237677000000" }), deps())).toBe("not_backoffice");
    db.seed("channel_identities", [identity()]);
    expect(await handleWhatsAppBackoffice(msg("stock du savon ?"), deps())).toBe("handled");
    expect(runtimeActors[0]).toMatchObject({ tenantId: ORG, membershipId: "mem-1", role: "owner", channel: "whatsapp" });
    expect(replies.at(-1)).toMatchObject({ content: "Stock : 12.", externalThreadId: "conv-1" });
  });
  it("identité révoquée ou 'pending' : jamais d'acteur", async () => {
    enable(); db.seed("channel_identities", [identity({ status: "pending" })]);
    expect(await handleWhatsAppBackoffice(msg("stock ?"), deps())).toBe("not_backoffice");
    expect(runtimeActors).toHaveLength(0);
  });
  it("mode dédié : un inconnu reçoit un refus et n'atteint JAMAIS le pipeline client", async () => {
    enable({ enabled: false, dedicated_account_id: "acc-ded" });
    const r = await handleWhatsAppBackoffice(msg("bonjour", { accountId: "acc-ded", phoneE164: "+237677000000" }), deps());
    expect(r).toBe("handled"); expect(replies[0]!.content).toMatch(/réservé/);
    expect(runtimeActors).toHaveLength(0);
  });
  it("numéro dédié mais message arrivé sur un autre compte : pas de back-office (désactivé)", async () => {
    enable({ enabled: false, dedicated_account_id: "acc-ded" });
    expect(await handleWhatsAppBackoffice(msg("x", { accountId: "autre" }), deps())).toBe("not_backoffice");
  });
  it("numéro absent du payload : client en partagé, refus en dédié", async () => {
    enable();
    expect(await handleWhatsAppBackoffice(msg("x", { phoneE164: undefined }), deps())).toBe("not_backoffice");
  });
  it("un membre lié dans une AUTRE entreprise n'est pas le personnel de celle-ci", async () => {
    enable(); db.seed("channel_identities", [identity({ organization_id: OTHER, id: "idn-x" })]);
    expect(await handleWhatsAppBackoffice(msg("stock ?"), deps())).toBe("not_backoffice");
  });
});

describe("liaison LIER CODE", () => {
  beforeEach(() => enable());
  it("le code est consommé avec le numéro de l'EXPÉDITEUR (transport), pas un numéro du texte", async () => {
    consume.mockReturnValue({ data: [{ id: "i1", organization_id: ORG, membership_id: "mem-1" }], error: null });
    expect(await handleWhatsAppBackoffice(msg("LIER ABCDE23456 +237611111111"), deps())).toBe("not_backoffice"); // format invalide : pas une commande
    expect(consume).not.toHaveBeenCalled();
    await handleWhatsAppBackoffice(msg("lier ABCDE23456"), deps());
    expect(consume).toHaveBeenCalledWith(expect.objectContaining({ p_channel: "whatsapp", p_external_id: PHONE }));
    expect(replies.at(-1)!.content).toMatch(/Numéro relié/);
  });
  it("code invalide / consommé / expiré : message clair, jamais d'acteur", async () => {
    for (const [code, re] of [["CODE_INVALID", /invalide/], ["CODE_CONSUMED", /déjà été utilisé/], ["CODE_EXPIRED", /expiré/], ["IDENTITY_ALREADY_LINKED", /déjà relié/]] as const) {
      consume.mockReturnValue({ data: null, error: { message: code } });
      expect(await handleWhatsAppBackoffice(msg("LIER ABCDE23456"), deps())).toBe("handled");
      expect(replies.at(-1)!.content).toMatch(re);
    }
    expect(runtimeActors).toHaveLength(0);
  });
  it("code d'une AUTRE entreprise : lié, mais aucun pilotage via ce numéro, réponse générique", async () => {
    consume.mockReturnValue({ data: [{ id: "i1", organization_id: OTHER, membership_id: "m" }], error: null });
    await handleWhatsAppBackoffice(msg("LIER ABCDE23456"), deps());
    expect(replies.at(-1)!.content).toMatch(/numéro WhatsApp de l'entreprise concernée/);
    expect(db.rows("channel_identities")).toHaveLength(0);
  });
  it("limitation de tentatives : silence au-delà", async () => {
    limits.channel_link = 30;
    expect(await handleWhatsAppBackoffice(msg("LIER ABCDE23456"), deps())).toBe("handled");
    expect(consume).not.toHaveBeenCalled(); expect(replies).toHaveLength(0);
  });
});

describe("membre lié", () => {
  beforeEach(() => { enable(); db.seed("channel_identities", [identity()]); db.seed("memberships", [{ id: "mem-1", organization_id: ORG, user_id: "user-1", role: "owner" }]); });
  it("enregistre la fenêtre de 24 h et le fil de conversation", async () => {
    await handleWhatsAppBackoffice(msg("bonjour"), deps());
    expect(db.rows("channel_identities")[0]).toMatchObject({ last_inbound_at: new Date(NOW).toISOString(), whatsapp_conversation_id: "conv-1", whatsapp_account_id: "acc-1" });
  });
  it("AIDE et DECONNECTER (sans accent, avec ou sans /)", async () => {
    await handleWhatsAppBackoffice(msg("Aide"), deps()); expect(replies.at(-1)!.content).toMatch(/Commandes/);
    await handleWhatsAppBackoffice(msg("/déconnecter"), deps());
    expect(db.rows("channel_identities")[0]!.status).toBe("revoked");
    expect(runtimeActors).toHaveLength(0);
  });
  it("VU accuse la dernière alerte ouverte ; aucune => message", async () => {
    await handleWhatsAppBackoffice(msg("vu"), deps()); expect(replies.at(-1)!.content).toBe("Aucune alerte en cours.");
    db.seed("alerts", [{ id: "al-1", organization_id: ORG, status: "open", created_at: "2026-10-09T09:00:00.000Z" }]);
    await handleWhatsAppBackoffice(msg("VU"), deps());
    expect(db.rows("alerts")[0]).toMatchObject({ status: "acknowledged", acknowledged_via: "whatsapp", acknowledged_by: "mem-1" });
  });
  it("action sensible : AUCUN PIN ni bouton d'approbation, renvoi vers le tableau de bord (lien de validation si émis)", async () => {
    runtimeEvents = [{ type: "approval_required", card: card() }, { type: "done" }];
    await handleWhatsAppBackoffice(msg("rembourse la commande 12"), deps());
    const last = replies.at(-1)!;
    expect(last.content).toMatch(/tableau de bord/); expect(last.content).not.toMatch(/PIN/);
    expect(last.buttons).toEqual([{ text: "Ouvrir le tableau de bord", url: "https://app.test/dashboard/approve/tok-1" }]);
  });
  it("action sensible sans lien : bouton vers l'assistant", async () => {
    runtimeEvents = [{ type: "approval_required", card: card({ stepUp: { challengeId: "c", allowedMethods: ["pin"] } }) }, { type: "done" }];
    await handleWhatsAppBackoffice(msg("rembourse"), deps());
    expect(replies.at(-1)!.buttons![0]!.url).toBe("https://app.test/dashboard/assistant");
  });
  it("pièce jointe seule : explication, pas d'appel à l'agent ; vocal sans URL = échec explicite", async () => {
    await handleWhatsAppBackoffice(msg("", { hasAttachment: true, attachmentType: "image" }), deps());
    expect(replies.at(-1)!.content).toMatch(/pièces jointes/);
    await handleWhatsAppBackoffice(msg("", { hasAttachment: true, attachmentType: "audio" }), deps());
    expect(replies.at(-1)!.content).toMatch(/pas pu traiter ce vocal/);
    expect(runtimeActors).toHaveLength(0);
  });
  it("flood : silence au-delà de la limite", async () => {
    limits.whatsapp_backoffice = 20;
    expect(await handleWhatsAppBackoffice(msg("stock ?"), deps())).toBe("handled");
    expect(runtimeActors).toHaveLength(0); expect(replies).toHaveLength(0);
  });
  it("réponse longue découpée", async () => {
    runtimeEvents = [{ type: "text_delta", text: "mot ".repeat(2000) }, { type: "done" }];
    await handleWhatsAppBackoffice(msg("liste"), deps());
    expect(replies.length).toBeGreaterThan(1); expect(replies.every((r) => r.content.length <= 3800)).toBe(true);
  });
});

describe("réglages", () => {
  it("numéro dédié : uniquement un numéro connecté de l'entreprise", async () => {
    const { saveBackofficeSettings, getBackofficeSettingsView } = await import("./whatsapp-backoffice-service");
    db.seed("whatsapp_accounts", [{ organization_id: ORG, account_id: "acc-1", phone_number: PHONE, status: "connected", is_primary: true }, { organization_id: OTHER, account_id: "acc-x", status: "connected", is_primary: true }, { organization_id: ORG, account_id: "acc-off", status: "disconnected", is_primary: false }]);
    const c = db as unknown as SupabaseClient;
    await expect(saveBackofficeSettings(ORG, { enabled: true, dedicatedAccountId: "acc-x" }, c)).rejects.toThrow(/n'appartient pas/);
    await expect(saveBackofficeSettings(ORG, { enabled: true, dedicatedAccountId: "acc-off" }, c)).rejects.toThrow();
    await saveBackofficeSettings(ORG, { enabled: true, dedicatedAccountId: "acc-1" }, c);
    expect(await getBackofficeSettingsView(ORG, c)).toMatchObject({ enabled: true, dedicatedAccountId: "acc-1", numbers: [{ accountId: "acc-1", phone: PHONE, isPrimary: true }] });
    expect(db.rows("whatsapp_backoffice_settings")).toHaveLength(1);
  });
});

describe("vocaux (livrable F)", () => {
  const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0]);
  let transcribe: ReturnType<typeof vi.fn>; let fetched: string[];
  const voice = (over: Partial<WhatsAppInbound> = {}) => msg("", { hasAttachment: true, attachmentType: "audio", attachmentUrl: "https://media.zernio.com/v/1.ogg", ...over });
  function voiceDeps(over: { rate?: number | null; bytes?: Uint8Array; fail?: boolean } = {}): WhatsAppBackofficeDeps {
    const d = deps();
    d.downloadMedia = async (url) => { fetched.push(url); if (over.fail) throw new Error("Adresse de média non autorisée."); return { data: over.bytes ?? OGG }; };
    d.voice = { speech: { transcribe: transcribe as never }, rateLimit: async () => over.rate ?? null, onUsage: () => undefined };
    return d;
  }
  beforeEach(() => { transcribe = vi.fn(async () => ({ text: "Combien de savons en stock ?" })); fetched = []; enable(); db.seed("channel_identities", [identity({ memberships: { role: "employee", extra_permissions: {} } })]); });

  it("vocal du membre lié : transcrit, écho, même flux que le texte, acteur relu (employee)", async () => {
    expect(await handleWhatsAppBackoffice(voice(), voiceDeps())).toBe("handled");
    expect(runtimeTexts).toEqual(["Combien de savons en stock ?"]);
    expect(runtimeActors[0]).toMatchObject({ tenantId: ORG, role: "employee", channel: "whatsapp" });
    expect(replies[0]!.content).toBe("🎤 J'ai compris : « Combien de savons en stock ? »");
    expect(replies.at(-1)!.content).toBe("Stock : 12.");
  });
  it("un vocal ne peut rien valider : l'agent reçoit une donnée, decideApproval n'est jamais appelé", async () => {
    transcribe.mockResolvedValue({ text: "oui je confirme" });
    await handleWhatsAppBackoffice(voice(), voiceDeps());
    expect(runtimeTexts).toEqual(["oui je confirme"]); // decideApproval jette s'il est appelé
  });
  it("PIN dicté : rien transmis à l'agent, avertissement", async () => {
    transcribe.mockResolvedValue({ text: "mon code est 4 8 2 9 1 7" });
    await handleWhatsAppBackoffice(voice(), voiceDeps());
    expect(runtimeTexts).toHaveLength(0); expect(replies.at(-1)!.content).toMatch(/Ne dictez jamais votre code PIN/);
    expect(JSON.stringify(replies)).not.toMatch(/4 8 2 9 1 7/);
  });
  it("URL d'un hôte non autorisé / média expiré : message générique, pas de transcription", async () => {
    expect(await handleWhatsAppBackoffice(voice({ attachmentUrl: "https://evil.example/x.ogg" }), voiceDeps({ fail: true }))).toBe("handled");
    expect(replies.at(-1)!.content).toMatch(/pas pu traiter/); expect(transcribe).not.toHaveBeenCalled(); expect(runtimeTexts).toHaveLength(0);
  });
  it("sans URL exploitable : message générique", async () => {
    await handleWhatsAppBackoffice(voice({ attachmentUrl: undefined }), voiceDeps());
    expect(replies.at(-1)!.content).toMatch(/pas pu traiter/); expect(fetched).toHaveLength(0);
  });
  it("contenu non audio, indisponible ou limité : l'agent n'est pas appelé", async () => {
    await handleWhatsAppBackoffice(voice(), voiceDeps({ bytes: new TextEncoder().encode("MZ exécutable") }));
    expect(replies.at(-1)!.content).toMatch(/format audio/);
    const { SpeechUnavailableError } = await import("@/domain/ports/speech-port");
    transcribe.mockRejectedValue(new SpeechUnavailableError());
    await handleWhatsAppBackoffice(voice(), voiceDeps());
    expect(replies.at(-1)!.content).toMatch(/pas disponible/);
    await handleWhatsAppBackoffice(voice(), voiceDeps({ rate: 10 }));
    expect(replies.at(-1)!.content).toMatch(/Trop de vocaux/);
    expect(runtimeTexts).toHaveLength(0);
  });
  it("numéro non lié (mode partagé) : le vocal reste au pipeline client, jamais téléchargé ni transcrit", async () => {
    expect(await handleWhatsAppBackoffice(voice({ phoneE164: "+237677000000" }), voiceDeps())).toBe("not_backoffice");
    expect(fetched).toHaveLength(0); expect(transcribe).not.toHaveBeenCalled();
  });
  it("image ou document : toujours renvoyé vers le tableau de bord", async () => {
    await handleWhatsAppBackoffice(voice({ attachmentType: "image" }), voiceDeps());
    expect(replies.at(-1)!.content).toMatch(/tableau de bord/); expect(transcribe).not.toHaveBeenCalled();
  });
});
