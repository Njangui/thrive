/**
 * Critères d'acceptation C2 (brief §« Critères d'acceptation ») — tests de bout en bout, SANS réseau :
 * liaison, résolution de rôle, révocation, refus d'un outil hors rôle, approbation Telegram,
 * modèle WhatsApp hors fenêtre, et « un employé ne déclenche jamais une action de rôle supérieur par
 * aucun canal ».
 *
 * Vrais composants : services Telegram/WhatsApp/chat/identités, outils Opérations, règles de rôle,
 * envoi WhatsApp. Faux : base (FakeDb), Zernio/Telegram (enregistreurs), services métier (espions) et
 * le RUNTIME C1, remplacé par `ContractRuntime` — un moteur minimal du contrat (outil → risque →
 * carte `sensitive` liée à l'acteur → exécution après validation) pour tester les canaux de bout en
 * bout tant que C1 n'a pas livré. « Le modèle » est simulé par des messages `outil <nom> <json>`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "../../../tests/helpers/fake-supabase";
import { handleBackofficeCallback, handleBackofficeMessage, type BackofficeDeps } from "@/application/services/telegram-backoffice-service";
import { handleWhatsAppBackoffice, type WhatsAppBackofficeDeps, type WhatsAppInbound } from "@/application/services/whatsapp-backoffice-service";
import { streamAssistantTurn, decideApprovalFromChat, type ChatDeps } from "@/application/services/assistant-chat-service";
import { sendWhatsAppToMember, type SendDeps } from "@/application/services/whatsapp-send-service";
import { buildOpsTools } from "@/application/agents/ops";
import type { OpsServices } from "@/application/agents/ops/ops-services";
import type { ToolDef } from "@/application/agents/ops/ops-contract";
import type { AgentActor } from "@/application/channels/actor";
import { AuthorizationError } from "@/lib/errors";
import type { AgentEvent, AgentRuntimePort, ApprovalOutcome } from "@/domain/ports/agent-runtime-port";
import type { StepUpPort } from "@/domain/ports/step-up-port";
import type { OutboundMessage } from "@/domain/ports/messaging-provider";
import type { TelegramCallbackQuery, TelegramMessage } from "@/infrastructure/providers/telegram/types";

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/infrastructure/providers/registry", () => ({ getMessagingProviderForChannel: vi.fn(), getEmailProvider: async () => ({}) }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.test" } }));

const NOW = Date.parse("2026-10-13T10:00:00Z");
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PID = "00000000-0000-4000-8000-000000000010";
const OID = "00000000-0000-4000-8000-000000000020";
const TG = 555, PHONE = "+237699000001", CODE = "ABCDE23456";

// --- Faux services métier (espions) ---------------------------------------------------------------
let svc: Record<keyof OpsServices, ReturnType<typeof vi.fn>>;
const product = () => ({ id: PID, name: "Savon", description: "Bio", categoryName: null, categoryId: null, unitPrice: 1500, compareAtPrice: null, promotionEndsAt: null, isPromotionExpired: false, currentStock: 10, status: "active", imageUrl: null, seoTitle: null, seoDescription: null, specifications: [] });
const order = () => ({ id: OID, status: "pending", totalAmount: 4500, currency: "XAF", createdAt: "2026-10-12T08:00:00Z", contactName: "Awa", contactPhone: "+237699000009", notes: null, items: [{ id: "i", label: "Savon", unitPrice: 1500, quantity: 3 }] });
function freshServices() {
  svc = {
    listOrders: vi.fn(async () => ({ totalCount: 0, orders: [] })), getOrder: vi.fn(async () => order()), createOrder: vi.fn(), completeOrder: vi.fn(), cancelOrder: vi.fn(async () => undefined),
    refundedTotal: vi.fn(async () => 0), refundThreshold: vi.fn(async () => 2000), alertRefund: vi.fn(async () => undefined),
    recordRefund: vi.fn(async (i: { amount: number }) => ({ refundId: "r-1", orderTotal: 4500, refundedTotal: i.amount, currency: "XAF", remaining: 4500 - i.amount })),
    findProducts: vi.fn(async () => []), getProduct: vi.fn(async () => product()), updateProduct: vi.fn(async () => undefined), restock: vi.fn(), decrement: vi.fn(), lowStock: vi.fn(async () => []),
    findContacts: vi.fn(async () => []), getContact: vi.fn(), listAppointments: vi.fn(async () => []), createAppointment: vi.fn(), setAppointmentStatus: vi.fn(),
    createExpense: vi.fn(), createRevenue: vi.fn(), recentFinance: vi.fn(async () => []), financialOverview: vi.fn(), currency: vi.fn(async () => "XAF"),
  } as never;
}

// --- Moteur de contrat minimal (substitut de C1) ---------------------------------------------------
interface Pending { id: string; membershipId: string; tool: string; input: unknown; done: boolean }
let pendings: Map<string, Pending>; let seq = 0; const now = () => new Date(NOW);

function contractRuntime(): AgentRuntimePort {
  const tools = new Map(buildOpsTools(svc as unknown as OpsServices).map((t) => [t.name, t as unknown as ToolDef<unknown, unknown>]));
  return {
    name: "contract-test",
    async *run({ actor, text }): AsyncGenerator<AgentEvent> {
      const m = /^outil (\S+) (.+)$/.exec(text);
      if (!m) { yield { type: "text_delta", text: "Que puis-je faire ?" }; yield { type: "done" }; return; }
      const tool = tools.get(m[1]!);
      if (!tool) { yield { type: "text_delta", text: "Outil inconnu." }; yield { type: "done" }; return; }
      const input = tool.input.parse(JSON.parse(m[2]!));
      const ctx = { actor, now };
      try {
        if (tool.risk === "sensitive") {
          const preview = await tool.preview!(ctx, input); // garde de rôle appliquée AVANT la carte
          const id = `pa-${++seq}`; pendings.set(id, { id, membershipId: actor.membershipId, tool: tool.name, input, done: false });
          yield { type: "approval_required", card: { pendingActionId: id, tool: tool.name, title: preview.title, summary: preview.summary, risk: "sensitive", details: preview.details, expiresAt: new Date(NOW + 600_000).toISOString(), stepUp: { challengeId: `ch-${id}`, allowedMethods: ["pin"] } } };
        } else {
          const out = await tool.run(ctx, input);
          yield { type: "text_delta", text: `OK ${tool.name} ${JSON.stringify(out).slice(0, 80)}` };
        }
      } catch (error) {
        if (error instanceof AuthorizationError) { yield { type: "text_delta", text: "Action non autorisée pour votre rôle." }; yield { type: "done" }; return; }
        throw error;
      }
      yield { type: "done" };
    },
    async decideApproval({ actor, pendingActionId, decision }): Promise<ApprovalOutcome> {
      const p = pendings.get(pendingActionId);
      if (!p || p.membershipId !== actor.membershipId) return { status: "failed", message: "Demande introuvable." };
      if (p.done) return { status: "failed", message: "Déjà traitée." };
      if (decision === "reject") { p.done = true; return { status: "rejected", message: "Refusée." }; }
      const tool = tools.get(p.tool)!;
      try { await tool.run({ actor, now }, p.input); } catch (e) { if (e instanceof AuthorizationError) return { status: "failed", message: "Droits insuffisants." }; throw e; }
      p.done = true; return { status: "executed", message: "Action exécutée." };
    },
    async listVisibleTools() { return []; },
  };
}

// --- Canaux ------------------------------------------------------------------------------------------
let db: FakeDb; let tgSent: { chat_id: number | string; text: string; reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] } }[]; let waReplies: OutboundMessage[];
const stepUp = { approveWithPin: vi.fn(), approveWithDashboardLink: vi.fn(), approveWithTelegramButton: vi.fn(), isApproved: vi.fn() };
const chat = (): ChatDeps => ({ db: db as unknown as SupabaseClient, runtime: contractRuntime(), stepUp: stepUp as unknown as StepUpPort, rateLimit: async () => null, now: () => NOW });
const tgDeps = (): BackofficeDeps => ({
  db: db as unknown as SupabaseClient, chat: chat(), rateLimit: async () => null, now: () => NOW, appUrl: "https://app.test",
  tg: { async sendMessage(p) { tgSent.push(p as (typeof tgSent)[number]); return { message_id: 100 + tgSent.length, chat: { id: Number(p.chat_id), type: "private" }, date: 0 }; }, async editMessageText() { return {}; }, async deleteMessage() { return true as const; }, async answerCallbackQuery() { return true as const; } },
});
const waDeps = (): WhatsAppBackofficeDeps => ({ db: db as unknown as SupabaseClient, chat: chat(), rateLimit: async () => null, now: () => NOW, appUrl: "https://app.test", reply: async (_o, _a, m) => { waReplies.push(m); } });
const tgMsg = (text: string, over: Partial<TelegramMessage> = {}): TelegramMessage => ({ message_id: 1, from: { id: TG, is_bot: false, first_name: "Marc", username: "marc" }, chat: { id: TG, type: "private" }, date: 0, text, ...over });
const tgClick = (data: string): TelegramCallbackQuery => ({ id: "cb", from: { id: TG, is_bot: false, first_name: "Marc" }, message: { message_id: 200, chat: { id: TG, type: "private" }, date: 0, text: "carte" }, data });
const waMsg = (text: string, over: Partial<WhatsAppInbound> = {}): WhatsAppInbound => ({ organizationId: ORG, accountId: "acc-1", conversationId: "conv-1", phoneE164: PHONE, text, hasAttachment: false, ...over });
const lastTg = () => tgSent.at(-1)?.text ?? "";
const lastWa = () => waReplies.at(-1)?.content ?? "";

/** Insère/relit le membre : le rôle vit dans `memberships` et est relu à chaque message. */
function seedMember(role: string, channel: "telegram" | "whatsapp") {
  db.seed("channel_identities", [{ id: `idn-${channel}`, organization_id: ORG, membership_id: "mem-1", user_id: "user-1", channel, external_id: channel === "telegram" ? String(TG) : PHONE, status: "active", memberships: { role, extra_permissions: {} }, organizations: { status: "active", name: "Boutique" } }]);
}
const setRole = (role: string) => { for (const r of db.rows("channel_identities")) (r.memberships as { role: string }).role = role; };

beforeEach(() => {
  db = new FakeDb(); freshServices(); pendings = new Map(); seq = 0; tgSent = []; waReplies = [];
  db.defaults.assistant_messages = { status: "complete", parts: [] };
  db.defaults.assistant_threads = { last_message_at: "2026-01-01T00:00:00.000Z", title: null, archived_at: null };
  db.defaults.channel_approval_prompts = { status: "open" };
  db.seed("whatsapp_backoffice_settings", [{ organization_id: ORG, enabled: true, dedicated_account_id: null }]);
  db.rpcHandlers.revoke_channel_identity = (a) => { const r = db.rows("channel_identities").find((x) => x.id === a.p_identity_id); if (!r || r.status === "revoked") return { data: false, error: null }; r.status = "revoked"; return { data: true, error: null }; };
  Object.values(stepUp).forEach((f) => f.mockReset()); stepUp.isApproved.mockResolvedValue(false);
});

describe("1. liaison → résolution de rôle → révocation (Telegram)", () => {
  it("parcours complet", async () => {
    // Avant liaison : inconnu.
    await handleBackofficeMessage(tgMsg("outil orders.list {}"), tgDeps());
    expect(lastTg()).toMatch(/n'est relié à aucun compte/); expect(svc.listOrders).not.toHaveBeenCalled();
    // Liaison : /start CODE — le membre est créé avec le rôle du membership.
    db.rpcHandlers.consume_channel_link_code = () => { seedMember("manager", "telegram"); return { data: { id: "idn-telegram", organization_id: ORG, membership_id: "mem-1" }, error: null }; };
    await handleBackofficeMessage(tgMsg(`/start ${CODE}`), tgDeps());
    expect(lastTg()).toMatch(/Compte relié/);
    // Résolution : manager peut lister les commandes.
    await handleBackofficeMessage(tgMsg("outil orders.list {}"), tgDeps());
    expect(svc.listOrders).toHaveBeenCalledWith(ORG, expect.anything());
    // Rôle relu à CHAQUE message : rétrogradé en employee → refus immédiat, sans redémarrage ni reliaison.
    setRole("employee"); svc.listOrders.mockClear();
    await handleBackofficeMessage(tgMsg("outil orders.list {}"), tgDeps());
    expect(lastTg()).toMatch(/non autorisée/); expect(svc.listOrders).not.toHaveBeenCalled();
    // Révocation par commande : plus aucun accès.
    await handleBackofficeMessage(tgMsg("/deconnecter"), tgDeps());
    setRole("owner");
    await handleBackofficeMessage(tgMsg("outil orders.list {}"), tgDeps());
    expect(lastTg()).toMatch(/n'est relié à aucun compte/); expect(svc.listOrders).not.toHaveBeenCalled();
    expect(db.rows("channel_identities")[0]!.status).toBe("revoked");
  });
});

describe("2. refus d'un outil hors rôle — AUCUN canal ne contourne le rôle", () => {
  const SENSITIVE: [string, string][] = [["orders.refund", JSON.stringify({ orderId: OID, amount: 100, reason: "Erreur" })], ["orders.cancel", JSON.stringify({ orderId: OID })], ["products.setPrice", JSON.stringify({ productId: PID, newUnitPrice: 1 })]];
  const WRITES: [string, string][] = [["stock.restock", JSON.stringify({ productId: PID, quantity: 5 })], ["expenses.create", JSON.stringify({ amount: 5000 })], ["orders.complete", JSON.stringify({ orderId: OID })]];

  it("Telegram : un employé ne peut ni écrire ni déclencher d'action sensible, aucune carte n'est émise", async () => {
    seedMember("employee", "telegram");
    for (const [name, json] of [...SENSITIVE, ...WRITES]) await handleBackofficeMessage(tgMsg(`outil ${name} ${json}`), tgDeps());
    expect(tgSent.every((m) => /non autorisée/.test(m.text))).toBe(true);
    expect(db.rows("channel_approval_prompts")).toHaveLength(0); expect(pendings.size).toBe(0);
    for (const k of ["cancelOrder", "recordRefund", "updateProduct", "restock", "createExpense", "completeOrder"] as const) expect(svc[k], k).not.toHaveBeenCalled();
  });
  it("WhatsApp : même refus", async () => {
    seedMember("employee", "whatsapp");
    for (const [name, json] of [...SENSITIVE, ...WRITES]) await handleWhatsAppBackoffice(waMsg(`outil ${name} ${json}`), waDeps());
    expect(waReplies.every((m) => /non autorisée/.test(m.content))).toBe(true); expect(pendings.size).toBe(0);
    for (const k of ["cancelOrder", "recordRefund", "updateProduct", "restock", "createExpense", "completeOrder"] as const) expect(svc[k], k).not.toHaveBeenCalled();
  });
  it("Dashboard : même refus pour l'acteur « dashboard »", async () => {
    const actor: AgentActor = { userId: "user-1", tenantId: ORG, membershipId: "mem-1", role: "employee", extraPermissions: [], channel: "dashboard" };
    db.seed("assistant_threads", [{ id: "th-1", organization_id: ORG, user_id: "user-1", title: null, last_message_at: "2026-01-01T00:00:00.000Z", archived_at: null }]);
    const frames: string[] = [];
    for (const [name, json] of [...SENSITIVE, ...WRITES]) for await (const f of streamAssistantTurn({ actor, threadId: "th-1", text: `outil ${name} ${json}` }, chat())) if (f.type === "text_delta") frames.push(f.text);
    expect(frames.every((t) => /non autorisée/.test(t))).toBe(true); expect(pendings.size).toBe(0);
    for (const k of ["cancelOrder", "recordRefund", "updateProduct", "restock", "createExpense", "completeOrder"] as const) expect(svc[k], k).not.toHaveBeenCalled();
  });
  it("un employé ne peut pas approuver la carte d'un autre membre (même identifiant de carte)", async () => {
    seedMember("manager", "telegram");
    await handleBackofficeMessage(tgMsg(`outil products.setPrice ${JSON.stringify({ productId: PID, newUnitPrice: 2000 })}`), tgDeps());
    const pending = [...pendings.values()][0]!;
    const intruder: AgentActor = { userId: "user-2", tenantId: ORG, membershipId: "mem-2", role: "owner", extraPermissions: [], channel: "dashboard" };
    const out = await contractRuntime().decideApproval({ actor: intruder, pendingActionId: pending.id, decision: "approve" });
    expect(out.status).toBe("failed"); expect(svc.updateProduct).not.toHaveBeenCalled();
  });
});

describe("3. approbation Telegram d'une action sensible", () => {
  async function askPriceChange() {
    seedMember("manager", "telegram");
    await handleBackofficeMessage(tgMsg(`outil products.setPrice ${JSON.stringify({ productId: PID, newUnitPrice: 2000 })}`), tgDeps());
    return db.rows("channel_approval_prompts")[0]!.id as string;
  }
  it("carte rédigée par le code → bouton → PIN → exécution UNE seule fois ; le texte « oui » ne valide rien", async () => {
    const id = await askPriceChange();
    expect(tgSent.some((m) => /1.?500/.test(m.text) && /2.?000/.test(m.text))).toBe(true); // ancien et nouveau prix calculés par le code
    expect(svc.updateProduct).not.toHaveBeenCalled(); // rien n'est modifié avant le « oui »
    await handleBackofficeMessage(tgMsg("oui, valide"), tgDeps());
    expect(svc.updateProduct).not.toHaveBeenCalled();
    await handleBackofficeCallback(tgClick(`ap:y:${id}`), tgDeps());
    stepUp.approveWithPin.mockResolvedValue({ ok: true, challengeId: "ch", method: "pin" });
    await handleBackofficeMessage(tgMsg("493817", { message_id: 77 }), tgDeps());
    expect(svc.updateProduct).toHaveBeenCalledTimes(1);
    expect(svc.updateProduct.mock.calls[0]![2]).toMatchObject({ unitPrice: 2000 });
    expect(lastTg()).toMatch(/Action exécutée/);
    // Rejeu du même bouton : pas de seconde exécution.
    await handleBackofficeCallback(tgClick(`ap:y:${id}`), tgDeps());
    expect(svc.updateProduct).toHaveBeenCalledTimes(1);
  });
  it("refus : rien n'est exécuté", async () => {
    const id = await askPriceChange();
    await handleBackofficeCallback(tgClick(`ap:n:${id}`), tgDeps());
    expect(svc.updateProduct).not.toHaveBeenCalled();
  });
  it("rôle rétrogradé entre la carte et la validation : l'exécution est refusée (droits relus)", async () => {
    const id = await askPriceChange();
    setRole("employee");
    await handleBackofficeCallback(tgClick(`ap:y:${id}`), tgDeps());
    stepUp.approveWithPin.mockResolvedValue({ ok: true, challengeId: "ch", method: "pin" });
    await handleBackofficeMessage(tgMsg("493817"), tgDeps());
    expect(svc.updateProduct).not.toHaveBeenCalled();
  });
  it("WhatsApp : la carte renvoie vers le tableau de bord, jamais de validation dans le chat (échange de SIM)", async () => {
    seedMember("manager", "whatsapp");
    await handleWhatsAppBackoffice(waMsg(`outil orders.cancel ${JSON.stringify({ orderId: OID })}`), waDeps());
    expect(waReplies.at(-1)!.buttons?.[0]?.url).toMatch(/^https:\/\/app\.test\/dashboard\//);
    expect(lastWa()).toMatch(/tableau de bord/);
    await handleWhatsAppBackoffice(waMsg("oui je valide"), waDeps());
    await handleWhatsAppBackoffice(waMsg("493817"), waDeps());
    expect(svc.cancelOrder).not.toHaveBeenCalled(); expect(stepUp.approveWithPin).not.toHaveBeenCalled();
  });
  it("dashboard : l'approbation passe par decideApprovalFromChat avec l'acteur de la session", async () => {
    const actor: AgentActor = { userId: "user-1", tenantId: ORG, membershipId: "mem-1", role: "manager", extraPermissions: [], channel: "dashboard" };
    db.seed("assistant_threads", [{ id: "th-1", organization_id: ORG, user_id: "user-1", title: null, last_message_at: "2026-01-01T00:00:00.000Z", archived_at: null }]);
    let card: { pendingActionId: string } | undefined;
    for await (const f of streamAssistantTurn({ actor, threadId: "th-1", text: `outil orders.cancel ${JSON.stringify({ orderId: OID })}` }, chat())) if (f.type === "approval_required") card = f.card;
    expect(svc.cancelOrder).not.toHaveBeenCalled();
    const msg = db.rows("assistant_messages").find((r) => r.role === "assistant")!;
    stepUp.approveWithPin.mockResolvedValue({ ok: true, challengeId: "ch", method: "pin" });
    const r = await decideApprovalFromChat({ actor, messageId: msg.id as string, pendingActionId: card!.pendingActionId, decision: "approve", pin: "493817" }, chat());
    expect(r.ok).toBe(true); expect(svc.cancelOrder).toHaveBeenCalledTimes(1);
  });
});

describe("3 bis. remboursement : seuil du propriétaire et validation", () => {
  beforeEach(() => { svc.getOrder.mockResolvedValue({ ...order(), status: "completed" }); });
  const ask = (amount: number) => handleBackofficeMessage(tgMsg(`outil orders.refund ${JSON.stringify({ orderId: OID, amount, reason: "Produit défectueux" })}`), tgDeps());
  it("sous le seuil : carte → PIN → remboursement enregistré une seule fois, alerte levée", async () => {
    seedMember("manager", "telegram"); await ask(1500);
    const id = db.rows("channel_approval_prompts")[0]!.id as string;
    expect(svc.recordRefund).not.toHaveBeenCalled();
    await handleBackofficeCallback(tgClick(`ap:y:${id}`), tgDeps());
    stepUp.approveWithPin.mockResolvedValue({ ok: true, challengeId: "ch", method: "pin" });
    await handleBackofficeMessage(tgMsg("493817"), tgDeps());
    expect(svc.recordRefund).toHaveBeenCalledTimes(1); expect(svc.alertRefund).toHaveBeenCalledTimes(1);
  });
  it("au-dessus du seuil : un manager n'obtient même pas de carte ; un owner oui", async () => {
    seedMember("manager", "telegram"); await ask(3000);
    expect(db.rows("channel_approval_prompts")).toHaveLength(0); expect(lastTg()).toMatch(/non autorisée/);
    setRole("owner"); await ask(3000);
    expect(db.rows("channel_approval_prompts")).toHaveLength(1); expect(svc.recordRefund).not.toHaveBeenCalled();
  });
});

describe("4. WhatsApp hors fenêtre de 24 h : modèle approuvé", () => {
  let templates: { templateName: string; participantId: string; templateParams?: string[] }[]; let sessions: OutboundMessage[];
  const sendDeps = (): SendDeps => ({
    db: db as unknown as SupabaseClient, now: () => NOW, sendSession: async (_o, _a, m) => { sessions.push(m); },
    client: { startConversationWithTemplate: async (p: never) => { templates.push(p); return {} as never; } } as never,
  });
  const identityRow = (lastInbound: string | null) => db.seed("channel_identities", [{ organization_id: ORG, channel: "whatsapp", external_id: PHONE, status: "active", last_inbound_at: lastInbound, whatsapp_conversation_id: "conv-1", whatsapp_account_id: "acc-1" }]);
  const input = { organizationId: ORG, e164: PHONE, text: "🚨 Rupture du produit phare", template: { key: "alert" as const, values: ["Rupture", "Savon"] } };
  beforeEach(() => { templates = []; sessions = []; });

  it("fenêtre ouverte (écrit il y a 2 h) : message libre", async () => {
    identityRow(new Date(NOW - 2 * 3600_000).toISOString());
    expect(await sendWhatsAppToMember(input, sendDeps())).toEqual({ status: "sent", via: "session" });
    expect(sessions).toHaveLength(1); expect(templates).toHaveLength(0);
  });
  it("fenêtre fermée (25 h) : modèle approuvé, JAMAIS de message libre", async () => {
    identityRow(new Date(NOW - 25 * 3600_000).toISOString());
    db.seed("whatsapp_templates", [{ organization_id: ORG, template_key: "alert", status: "APPROVED", name: "flexco_alerte_v1", language: "fr" }]);
    const r = await sendWhatsAppToMember(input, sendDeps());
    expect(sessions).toHaveLength(0);
    expect(r).toEqual({ status: "sent", via: "template" });
    expect(templates[0]).toMatchObject({ templateName: "flexco_alerte_v1", participantId: "237699000001" });
  });
  it("fenêtre fermée et modèle non approuvé : rien n'est envoyé (jamais hors règles Meta)", async () => {
    identityRow(null);
    db.seed("whatsapp_templates", [{ organization_id: ORG, template_key: "alert", status: "PENDING", name: "flexco_alerte_v1", language: "fr" }]);
    const r = await sendWhatsAppToMember(input, sendDeps());
    expect(r.status).toBe("skipped"); expect(sessions).toHaveLength(0); expect(templates).toHaveLength(0);
  });
  it("numéro non lié : aucun envoi", async () => {
    expect((await sendWhatsAppToMember(input, sendDeps())).status).toBe("skipped"); expect(sessions.length + templates.length).toBe(0);
  });
});
