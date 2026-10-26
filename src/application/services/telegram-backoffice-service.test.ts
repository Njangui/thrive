import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "../../../tests/helpers/fake-supabase";
import { handleBackofficeCallback, handleBackofficeMessage, type BackofficeDeps } from "./telegram-backoffice-service";
import type { AgentEvent, AgentRuntimePort, ApprovalCard, ApprovalOutcome } from "@/domain/ports/agent-runtime-port";
import type { StepUpPort } from "@/domain/ports/step-up-port";
import type { TelegramCallbackQuery, TelegramMessage } from "@/infrastructure/providers/telegram/types";
import type { RateLimitKind } from "@/lib/rate-limit";

const NOW = Date.parse("2026-10-09T10:00:00Z");
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TG = 555; // identifiant Telegram du membre
const CODE = "ABCDE23456";

let db: FakeDb; let sent: { chat_id: number | string; text: string; reply_markup?: { inline_keyboard?: { text: string; callback_data?: string; url?: string }[][] }; parse_mode?: string }[];
let edits: { message_id: number; text: string }[]; let deleted: number[]; let answers: { id: string; text?: string; alert?: boolean }[];
let runtimeEvents: AgentEvent[]; let runtimeActors: unknown[]; let runtimeTexts: string[]; let decideCalls: Record<string, unknown>[]; let decideOutcome: ApprovalOutcome;
let limits: Partial<Record<RateLimitKind, number | null>>;
const stepUp = { approveWithPin: vi.fn(), approveWithDashboardLink: vi.fn(), approveWithTelegramButton: vi.fn(), isApproved: vi.fn() };
let msgSeq = 100;

const card = (over: Partial<ApprovalCard> = {}): ApprovalCard => ({
  pendingActionId: "pa-1", tool: "orders.refund", title: "Rembourser #12", summary: "5 000 FCFA", risk: "sensitive",
  details: [{ label: "Montant", value: "5 000 FCFA" }], expiresAt: new Date(NOW + 600_000).toISOString(),
  stepUp: { challengeId: "ch-1", allowedMethods: ["pin"] }, ...over,
});

function deps(): BackofficeDeps {
  const runtime: AgentRuntimePort = {
    name: "fake",
    async *run(input) { runtimeActors.push(input.actor); runtimeTexts.push(input.text); for (const e of runtimeEvents) yield e; },
    async decideApproval(i) { decideCalls.push(i as unknown as Record<string, unknown>); return decideOutcome; },
    async listVisibleTools() { return []; },
  };
  return {
    db: db as unknown as SupabaseClient,
    tg: {
      async sendMessage(p) { sent.push(p as (typeof sent)[number]); msgSeq += 1; return { message_id: msgSeq, chat: { id: Number(p.chat_id), type: "private" }, date: 0 }; },
      async editMessageText(p) { edits.push({ message_id: p.message_id, text: p.text }); return {}; },
      async deleteMessage(_c, id) { deleted.push(id); return true as const; },
      async answerCallbackQuery(id, text, alert) { answers.push({ id, text, alert }); return true as const; },
    },
    chat: { db: db as unknown as SupabaseClient, runtime, stepUp: stepUp as unknown as StepUpPort, rateLimit: async () => null, now: () => NOW },
    rateLimit: async (kind) => limits[kind] ?? null,
    now: () => NOW,
    appUrl: "https://app.flexco.test",
  };
}

const msg = (text: string, over: Partial<TelegramMessage> = {}): TelegramMessage => ({ message_id: 1, from: { id: TG, is_bot: false, first_name: "Marc", username: "marc" }, chat: { id: TG, type: "private" }, date: 0, text, ...over });
const cbq = (data: string, over: Partial<TelegramCallbackQuery> = {}): TelegramCallbackQuery => ({ id: "cb-1", from: { id: TG, is_bot: false, first_name: "Marc" }, message: { message_id: 200, chat: { id: TG, type: "private" }, date: 0, text: "carte" }, data, ...over });

function identity(over: Record<string, unknown> = {}) {
  return { id: "idn-1", organization_id: ORG_A, membership_id: "mem-1", user_id: "user-1", channel: "telegram", external_id: String(TG), status: "active",
    memberships: { role: "employee", extra_permissions: {} }, organizations: { status: "active", name: "Boutique A" }, ...over };
}
const lastText = () => sent.at(-1)?.text ?? "";

beforeEach(() => {
  db = new FakeDb();
  db.defaults.assistant_messages = { status: "complete", parts: [] };
  db.defaults.assistant_threads = { last_message_at: "2026-01-01T00:00:00.000Z", title: null, archived_at: null };
  db.defaults.channel_approval_prompts = { status: "open" };
  db.rpcHandlers.revoke_channel_identity = (a) => { const r = db.rows("channel_identities").find((x) => x.id === a.p_identity_id); if (!r || r.status === "revoked") return { data: false, error: null }; r.status = "revoked"; return { data: true, error: null }; };
  sent = []; edits = []; deleted = []; answers = []; runtimeActors = []; runtimeTexts = []; decideCalls = []; limits = {}; msgSeq = 100;
  runtimeEvents = [{ type: "text_delta", text: "Voici vos commandes." }, { type: "done" }];
  decideOutcome = { status: "executed", message: "Remboursement effectué" };
  Object.values(stepUp).forEach((f) => f.mockReset()); stepUp.isApproved.mockResolvedValue(false);
});

describe("conversations privées uniquement", () => {
  it("un code de liaison posté dans un groupe n'est PAS consommé : message supprimé, avertissement", async () => {
    const consumed = vi.fn(); db.rpcHandlers.consume_channel_link_code = () => { consumed(); return { data: null, error: null }; };
    const handled = await handleBackofficeMessage(msg(`/start ${CODE}`, { chat: { id: -100, type: "supergroup" } }), deps());
    expect(handled).toBe(true); expect(consumed).not.toHaveBeenCalled(); expect(deleted).toEqual([1]);
    expect(lastText()).toMatch(/jamais ce code dans un groupe/);
  });
  it("un membre lié qui écrit dans un groupe : jamais routé vers l'agent", async () => {
    db.seed("channel_identities", [identity()]);
    expect(await handleBackofficeMessage(msg("rembourse tout", { chat: { id: -100, type: "group" } }), deps())).toBe(false);
    expect(runtimeActors).toHaveLength(0); expect(sent).toHaveLength(0);
  });
  it("chat privé mais chat.id ≠ from.id (message transféré/usurpé) : refusé", async () => {
    db.seed("channel_identities", [identity()]);
    expect(await handleBackofficeMessage(msg("salut", { chat: { id: 999, type: "private" } }), deps())).toBe(false);
    expect(runtimeActors).toHaveLength(0);
  });
  it("les bots sont ignorés", async () => {
    expect(await handleBackofficeMessage(msg("salut", { from: { id: TG, is_bot: true, first_name: "bot" } }), deps())).toBe(false);
  });
});

describe("liaison /start CODE", () => {
  it("code valide : compte relié, code supprimé du chat, libellé = @username", async () => {
    let args: Record<string, unknown> = {};
    db.rpcHandlers.consume_channel_link_code = (a) => { args = a; return { data: { id: "idn-9", organization_id: ORG_A, membership_id: "mem-1" }, error: null }; };
    expect(await handleBackofficeMessage(msg(`/start ${CODE}`), deps())).toBe(true);
    expect(args).toMatchObject({ p_channel: "telegram", p_external_id: String(TG), p_label: "@marc" });
    expect(deleted).toEqual([1]); expect(lastText()).toMatch(/Compte relié/);
  });
  it.each([["CODE_CONSUMED", /déjà été utilisé/], ["CODE_EXPIRED", /expiré/], ["IDENTITY_ALREADY_LINKED", /déjà relié/]])("%s → message clair", async (sql, re) => {
    db.rpcHandlers.consume_channel_link_code = () => ({ data: null, error: { message: sql } });
    expect(await handleBackofficeMessage(msg(`/start ${CODE}`), deps())).toBe(true); expect(lastText()).toMatch(re);
  });
  it("code inconnu ou jeton affilié : rendu au flux affilié existant (aucune régression)", async () => {
    db.rpcHandlers.consume_channel_link_code = () => ({ data: null, error: { message: "CODE_INVALID" } });
    expect(await handleBackofficeMessage(msg(`/start ${CODE}`), deps())).toBe(false);
    expect(await handleBackofficeMessage(msg("/start 0123456789abcdef0123456789abcdef"), deps())).toBe(false);
    expect(sent).toHaveLength(0);
  });
  it("limitation de débit sur les essais de code : la base n'est pas interrogée", async () => {
    const consumed = vi.fn(); db.rpcHandlers.consume_channel_link_code = () => { consumed(); return { data: null, error: null }; };
    limits.channel_link = 30;
    await handleBackofficeMessage(msg(`/start ${CODE}`), deps());
    expect(consumed).not.toHaveBeenCalled(); expect(lastText()).toMatch(/Trop de tentatives/);
  });
  it("anti-flood global : silence, aucune requête métier", async () => {
    db.seed("channel_identities", [identity()]); limits.telegram_backoffice = 10;
    expect(await handleBackofficeMessage(msg("salut"), deps())).toBe(true);
    expect(sent).toHaveLength(0); expect(runtimeActors).toHaveLength(0);
  });
});

describe("résolution et conversation", () => {
  it("inconnu : texte libre → invitation à relier ; commande → flux affilié", async () => {
    expect(await handleBackofficeMessage(msg("bonjour"), deps())).toBe(true); expect(lastText()).toMatch(/n'est relié à aucun compte/);
    sent = []; expect(await handleBackofficeMessage(msg("/mystats"), deps())).toBe(false); expect(sent).toHaveLength(0);
  });
  it("identité révoquée : traitée comme inconnue", async () => {
    db.seed("channel_identities", [identity({ status: "revoked" })]);
    await handleBackofficeMessage(msg("rembourse"), deps()); expect(runtimeActors).toHaveLength(0);
  });
  it("tenant suspendu : message dédié, agent non appelé", async () => {
    db.seed("channel_identities", [identity({ organizations: { status: "suspended", name: "A" } })]);
    await handleBackofficeMessage(msg("salut"), deps()); expect(lastText()).toMatch(/suspendue/); expect(runtimeActors).toHaveLength(0);
  });
  it("le runtime reçoit le RÔLE réel de l'identité (employé) et le canal telegram ; réponse en texte brut", async () => {
    db.seed("channel_identities", [identity()]);
    await handleBackofficeMessage(msg("mes commandes ?"), deps());
    expect(runtimeActors[0]).toMatchObject({ role: "employee", tenantId: ORG_A, membershipId: "mem-1", channel: "telegram" });
    expect(lastText()).toBe("Voici vos commandes."); expect(sent.every((s) => s.parse_mode === undefined)).toBe(true);
  });
  it("un seul fil « Telegram » réutilisé d'un message à l'autre", async () => {
    db.seed("channel_identities", [identity()]);
    await handleBackofficeMessage(msg("un"), deps()); await handleBackofficeMessage(msg("deux"), deps());
    expect(db.rows("assistant_threads").filter((t) => t.title === "Telegram")).toHaveLength(1);
    expect(db.rows("assistant_messages").filter((m) => m.role === "user")).toHaveLength(2);
  });
  it("réponses longues découpées sous la limite Telegram", async () => {
    db.seed("channel_identities", [identity()]);
    runtimeEvents = [{ type: "text_delta", text: "mot ".repeat(2500) }, { type: "done" }];
    await handleBackofficeMessage(msg("long"), deps());
    expect(sent.length).toBeGreaterThan(1); expect(sent.every((s) => s.text.length <= 4096)).toBe(true);
  });
  it("message trop long : refusé proprement ; message non textuel : explication", async () => {
    db.seed("channel_identities", [identity()]);
    await handleBackofficeMessage(msg("x".repeat(4100)), deps()); expect(lastText()).toMatch(/trop long/);
    await handleBackofficeMessage(msg("", { text: undefined }), deps()); expect(lastText()).toMatch(/uniquement|texte/i);
  });
  it("/deconnecter révoque l'identité", async () => {
    db.seed("channel_identities", [identity()]);
    await handleBackofficeMessage(msg("/deconnecter"), deps());
    expect(db.rows("channel_identities")[0]!.status).toBe("revoked"); expect(lastText()).toMatch(/délié/);
  });
  it("commande inconnue d'un membre lié : aide", async () => {
    db.seed("channel_identities", [identity()]); await handleBackofficeMessage(msg("/zzz"), deps()); expect(lastText()).toMatch(/Commande inconnue/);
  });
});

describe("plusieurs entreprises (/org)", () => {
  beforeEach(() => db.seed("channel_identities", [identity(), identity({ id: "idn-2", organization_id: ORG_B, membership_id: "mem-b", organizations: { status: "active", name: "Salon B" } })]));
  it("ambiguïté : boutons de choix, agent non appelé", async () => {
    await handleBackofficeMessage(msg("salut"), deps());
    expect(runtimeActors).toHaveLength(0);
    expect(sent.at(-1)!.reply_markup!.inline_keyboard!.flat().map((b) => b.callback_data)).toEqual([`o:${ORG_A}`, `o:${ORG_B}`]);
  });
  it("choix mémorisé, puis les messages suivants vont à CE tenant", async () => {
    await handleBackofficeCallback(cbq(`o:${ORG_B}`), deps());
    expect(db.rows("channel_active_org")[0]).toMatchObject({ organization_id: ORG_B, external_id: String(TG) });
    await handleBackofficeMessage(msg("salut"), deps());
    expect(runtimeActors[0]).toMatchObject({ tenantId: ORG_B });
  });
  it("on ne peut pas choisir une entreprise à laquelle on n'est pas lié", async () => {
    await handleBackofficeCallback(cbq("o:cccccccc-cccc-4ccc-8ccc-cccccccccccc"), deps());
    expect(db.rows("channel_active_org")).toHaveLength(0); expect(answers.at(-1)).toMatchObject({ alert: true });
  });
  it("/org rouvre le choix même si une entreprise est déjà active", async () => {
    await handleBackofficeCallback(cbq(`o:${ORG_A}`), deps()); sent = [];
    await handleBackofficeMessage(msg("/org"), deps());
    expect(sent.at(-1)!.reply_markup!.inline_keyboard!.flat()).toHaveLength(2);
  });
});

describe("approbations par boutons", () => {
  async function askRefund(c: ApprovalCard = card()) {
    db.seed("channel_identities", [identity()]);
    runtimeEvents = [{ type: "approval_required", card: c }, { type: "done" }];
    await handleBackofficeMessage(msg("rembourse #12"), deps());
    return db.rows("channel_approval_prompts")[0]!.id as string;
  }

  it("carte sensible (PIN seul) : boutons Valider/Refuser, aucune méthode « bouton » proposée", async () => {
    await askRefund();
    const kb = sent.at(-1)!.reply_markup!.inline_keyboard!;
    expect(kb[0]!.map((b) => b.text)).toEqual(["✅ Valider (PIN)", "❌ Refuser"]);
    expect(kb[0]![0]!.callback_data!.length).toBeLessThanOrEqual(64);
    expect(db.rows("channel_approval_prompts")[0]).toMatchObject({ membership_id: "mem-1", chat_id: String(TG), pending_action_id: "pa-1", channel_message_id: String(msgSeq) });
  });
  it("lien dashboard proposé en bouton URL quand autorisé", async () => {
    await askRefund(card({ stepUp: { challengeId: "ch-1", allowedMethods: ["pin", "dashboard_link"], linkToken: "tok_abc" } }));
    expect(sent.at(-1)!.reply_markup!.inline_keyboard![1]![0]!.url).toBe("https://app.flexco.test/dashboard/approve/tok_abc");
  });
  it("parcours PIN : Valider → attente du PIN → PIN supprimé du chat, action exécutée, carte figée", async () => {
    const id = await askRefund();
    await handleBackofficeCallback(cbq(`ap:y:${id}`), deps());
    expect(db.rows("channel_approval_prompts")[0]!.status).toBe("awaiting_pin"); expect(lastText()).toMatch(/PIN/);
    expect(decideCalls).toHaveLength(0);

    stepUp.approveWithPin.mockResolvedValue({ ok: true, challengeId: "ch-1", method: "pin" });
    await handleBackofficeMessage(msg("493817", { message_id: 77 }), deps());
    expect(deleted).toContain(77);
    expect(stepUp.approveWithPin).toHaveBeenCalledWith({ challengeId: "ch-1", membershipId: "mem-1", pin: "493817" });
    expect(decideCalls[0]).toMatchObject({ decision: "approve", stepUp: { challengeId: "ch-1" } });
    expect(lastText()).toMatch(/Remboursement effectué/);
    expect(db.rows("channel_approval_prompts")[0]!.status).toBe("done");
    expect(edits.at(-1)!.text).toMatch(/Rembourser #12[\s\S]*Remboursement effectué/);
    expect(JSON.stringify(db.rows("assistant_messages"))).not.toContain("493817");
  });
  it("mauvais PIN : essais restants, la carte reste en attente de PIN ; verrouillage : retour à l'état initial", async () => {
    const id = await askRefund(); await handleBackofficeCallback(cbq(`ap:y:${id}`), deps());
    stepUp.approveWithPin.mockResolvedValueOnce({ ok: false, reason: "pin_invalid", attemptsLeft: 2 });
    await handleBackofficeMessage(msg("000999"), deps());
    expect(lastText()).toMatch(/2 essai/); expect(decideCalls).toHaveLength(0); expect(db.rows("channel_approval_prompts")[0]!.status).toBe("awaiting_pin");
    stepUp.approveWithPin.mockResolvedValueOnce({ ok: false, reason: "locked", lockedUntil: "x" });
    await handleBackofficeMessage(msg("000998"), deps());
    expect(lastText()).toMatch(/verrouillé/); expect(db.rows("channel_approval_prompts")[0]!.status).toBe("open");
  });
  it("des chiffres SANS carte en attente de PIN = message ordinaire (jamais traité comme un PIN)", async () => {
    db.seed("channel_identities", [identity()]);
    await handleBackofficeMessage(msg("123987"), deps());
    expect(stepUp.approveWithPin).not.toHaveBeenCalled(); expect(runtimeActors).toHaveLength(1);
  });
  it("attente de PIN expirée : les chiffres ne sont plus pris pour un PIN", async () => {
    const id = await askRefund(); await handleBackofficeCallback(cbq(`ap:y:${id}`), deps());
    db.rows("channel_approval_prompts")[0]!.awaiting_pin_until = new Date(NOW - 1000).toISOString();
    await handleBackofficeMessage(msg("493817"), deps());
    expect(stepUp.approveWithPin).not.toHaveBeenCalled();
  });
  it("action à faible risque : le bouton Telegram suffit", async () => {
    const id = await askRefund(card({ risk: "write_reversible", stepUp: { challengeId: "ch-2", allowedMethods: ["telegram_button"] } }));
    stepUp.approveWithTelegramButton.mockResolvedValue({ ok: true, challengeId: "ch-2", method: "telegram_button" });
    await handleBackofficeCallback(cbq(`ap:y:${id}`), deps());
    expect(stepUp.approveWithTelegramButton).toHaveBeenCalledWith({ challengeId: "ch-2", membershipId: "mem-1" });
    expect(decideCalls[0]).toMatchObject({ decision: "approve" }); expect(edits.at(-1)!.text).toMatch(/✅/);
  });
  it("lien dashboard déjà validé à part : « Valider » dans Telegram poursuit sans PIN", async () => {
    const id = await askRefund(card({ stepUp: { challengeId: "ch-1", allowedMethods: ["pin", "dashboard_link"], linkToken: "tok" } }));
    stepUp.isApproved.mockResolvedValue(true);
    await handleBackofficeCallback(cbq(`ap:y:${id}`), deps());
    expect(decideCalls).toHaveLength(1);
  });
  it("carte sans step-up : exécutée directement", async () => {
    const id = await askRefund(card({ risk: "write_reversible", stepUp: undefined }));
    await handleBackofficeCallback(cbq(`ap:y:${id}`), deps()); expect(decideCalls).toHaveLength(1);
  });
  it("Refuser : exécution jamais déclenchée, carte figée", async () => {
    const id = await askRefund(); decideOutcome = { status: "rejected", message: "Refusée" };
    await handleBackofficeCallback(cbq(`ap:n:${id}`), deps());
    expect(decideCalls[0]).toMatchObject({ decision: "reject" }); expect(edits.at(-1)!.text).toMatch(/refusée/i); expect(db.rows("channel_approval_prompts")[0]!.status).toBe("done");
  });
  it("une carte déjà traitée ne l'est pas deux fois", async () => {
    const id = await askRefund(card({ stepUp: undefined, risk: "write_reversible" }));
    await handleBackofficeCallback(cbq(`ap:y:${id}`), deps()); await handleBackofficeCallback(cbq(`ap:y:${id}`, { id: "cb-2" }), deps());
    expect(decideCalls).toHaveLength(1); expect(answers.at(-1)!.text).toMatch(/Déjà traitée/);
  });
  it("carte expirée : figée, runtime non appelé", async () => {
    const id = await askRefund(); db.rows("channel_approval_prompts")[0]!.expires_at = new Date(NOW - 1000).toISOString();
    await handleBackofficeCallback(cbq(`ap:y:${id}`), deps());
    expect(decideCalls).toHaveLength(0); expect(db.rows("channel_approval_prompts")[0]!.status).toBe("expired"); expect(edits.at(-1)!.text).toMatch(/expirée/);
  });

  describe("détournement", () => {
    it("le bouton d'un AUTRE membre (autre id Telegram) est refusé, sans fuite d'existence", async () => {
      const id = await askRefund();
      await handleBackofficeCallback(cbq(`ap:y:${id}`, { from: { id: 777, is_bot: false, first_name: "X" }, message: { message_id: 1, chat: { id: 777, type: "private" }, date: 0 } }), deps());
      expect(answers.at(-1)).toMatchObject({ text: "Action non autorisée.", alert: true }); expect(decideCalls).toHaveLength(0);
    });
    it("identifiant de carte inexistant : même réponse que pour une carte étrangère", async () => {
      await askRefund(); await handleBackofficeCallback(cbq("ap:y:00000000-0000-4000-8000-000000000000"), deps());
      expect(answers.at(-1)).toMatchObject({ text: "Action non autorisée.", alert: true });
    });
    it("bouton cliqué depuis un groupe (carte transférée) : refusé", async () => {
      const id = await askRefund();
      await handleBackofficeCallback(cbq(`ap:y:${id}`, { message: { message_id: 1, chat: { id: -100, type: "group" }, date: 0 } }), deps());
      expect(decideCalls).toHaveLength(0); expect(answers.at(-1)!.alert).toBe(true);
    });
    it("membre délié entre-temps : le bouton ne fonctionne plus", async () => {
      const id = await askRefund(); db.rows("channel_identities")[0]!.status = "revoked";
      await handleBackofficeCallback(cbq(`ap:y:${id}`), deps());
      expect(decideCalls).toHaveLength(0); expect(answers.at(-1)!.text).toBe("Action non autorisée.");
    });
    it("callback_data étranger : non traité (rendu au reste du webhook)", async () => {
      expect(await handleBackofficeCallback(cbq("autre:chose"), deps())).toBe(false);
    });
  });
});

describe("accusé d'alerte (al:a:)", () => {
  const owner = () => identity({ memberships: { role: "owner", extra_permissions: {} } });
  const seedAlert = (org = ORG_A) => db.seed("alerts", [{ id: "al-1", organization_id: org, status: "open", escalation_step: 1, next_escalation_at: "2026-10-09T10:15:00.000Z" }]);
  beforeEach(() => { db.seed("memberships", [{ id: "mem-1", organization_id: ORG_A, user_id: "user-1", role: "owner" }, { id: "mem-x", organization_id: ORG_B, user_id: "user-1", role: "owner" }]); });

  it("propriétaire lié : alerte acquittée, escalade stoppée, carte figée", async () => {
    db.seed("channel_identities", [owner()]); seedAlert();
    expect(await handleBackofficeCallback(cbq("al:a:al-1"), deps())).toBe(true);
    expect(db.rows("alerts")[0]).toMatchObject({ status: "acknowledged", acknowledged_by: "mem-1", acknowledged_via: "telegram", next_escalation_at: null });
    expect(answers.at(-1)!.text).toBe("Alerte prise en compte.");
    expect(edits.at(-1)!.text).toContain("Prise en compte");
  });
  it("employé (ni propriétaire ni repli) : refusé, alerte intacte", async () => {
    db.seed("channel_identities", [identity()]); seedAlert(); db.rows("memberships")[0]!.role = "employee";
    await handleBackofficeCallback(cbq("al:a:al-1"), deps());
    expect(db.rows("alerts")[0]!.status).toBe("open"); expect(answers.at(-1)!.alert).toBe(true);
  });
  it("identité inconnue ou alerte d'une entreprise où le membre n'est pas lié : même refus", async () => {
    seedAlert(ORG_B); db.seed("channel_identities", [owner()]);
    await handleBackofficeCallback(cbq("al:a:al-1"), deps());
    expect(db.rows("alerts")[0]!.status).toBe("open"); expect(answers.at(-1)!.text).toBe("Action non autorisée.");
    await handleBackofficeCallback(cbq("al:a:inconnue"), deps());
    expect(answers.at(-1)!.text).toBe("Action non autorisée.");
  });
  it("jamais depuis un groupe", async () => {
    db.seed("channel_identities", [owner()]); seedAlert();
    await handleBackofficeCallback(cbq("al:a:al-1", { message: { message_id: 1, chat: { id: -100, type: "group" }, date: 0 } }), deps());
    expect(db.rows("alerts")[0]!.status).toBe("open");
  });
});

describe("vocaux (livrable F)", () => {
  const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0]);
  let transcribe: ReturnType<typeof vi.fn>; let downloads: string[];
  const voiceMsg = (voice: Record<string, unknown> = {}, over: Partial<TelegramMessage> = {}): TelegramMessage =>
    ({ message_id: 9, from: { id: TG, is_bot: false, first_name: "Marc" }, chat: { id: TG, type: "private" }, date: 0, voice: { file_id: "f-1", duration: 5, file_size: 20_000, mime_type: "audio/ogg", ...voice }, ...over });
  function voiceDeps(over: { rate?: number | null; bytes?: Uint8Array } = {}): BackofficeDeps {
    const d = deps();
    d.tg = { ...d.tg, getFile: async (id: string) => ({ file_id: id, file_path: "voice/f-1.oga" }), downloadFile: async (path: string) => { downloads.push(path); return { data: over.bytes ?? OGG, contentType: "audio/ogg" }; } };
    d.voice = { speech: { transcribe: transcribe as never }, rateLimit: async () => over.rate ?? null, onUsage: () => undefined };
    return d;
  }
  beforeEach(() => { transcribe = vi.fn(async () => ({ text: "Quelles commandes sont en attente ?" })); downloads = []; db.seed("channel_identities", [identity()]); });

  it("vocal → transcription → écho → même flux que le texte, avec l'acteur résolu", async () => {
    expect(await handleBackofficeMessage(voiceMsg({}, { text: undefined }), voiceDeps())).toBe(true);
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A, mimeType: "audio/ogg" }));
    expect(runtimeTexts).toEqual(["Quelles commandes sont en attente ?"]);
    expect(runtimeActors[0]).toMatchObject({ tenantId: ORG_A, role: "employee", channel: "telegram" });
    expect(sent[0]!.text).toBe("🎤 J'ai compris : « Quelles commandes sont en attente ? »");
    expect(lastText()).toBe("Voici vos commandes.");
  });
  it("un vocal n'approuve jamais rien (ni PIN, ni validation)", async () => {
    transcribe.mockResolvedValue({ text: "oui je valide le remboursement" });
    await handleBackofficeMessage(voiceMsg(), voiceDeps());
    expect(decideCalls).toHaveLength(0);
    expect(stepUp.approveWithPin).not.toHaveBeenCalled(); expect(stepUp.approveWithTelegramButton).not.toHaveBeenCalled();
    expect(runtimeTexts).toEqual(["oui je valide le remboursement"]); // simple donnée pour l'agent
  });
  it("PIN dicté : rien transmis à l'agent, vocal supprimé, avertissement", async () => {
    transcribe.mockResolvedValue({ text: "1 2 3 4 5 6" });
    await handleBackofficeMessage(voiceMsg(), voiceDeps());
    expect(runtimeTexts).toHaveLength(0); expect(stepUp.approveWithPin).not.toHaveBeenCalled();
    expect(deleted).toContain(9); expect(lastText()).toMatch(/Ne dictez jamais votre code PIN/);
    expect(JSON.stringify(sent)).not.toMatch(/1 2 3 4 5 6/);
  });
  it("trop long / trop gros : refus AVANT téléchargement", async () => {
    await handleBackofficeMessage(voiceMsg({ duration: 600 }), voiceDeps());
    expect(lastText()).toMatch(/trop long/);
    await handleBackofficeMessage(voiceMsg({ file_size: 50_000_000 }), voiceDeps());
    expect(lastText()).toMatch(/trop volumineux/);
    expect(downloads).toHaveLength(0); expect(transcribe).not.toHaveBeenCalled(); expect(runtimeTexts).toHaveLength(0);
  });
  it("contenu qui n'est pas de l'audio : refusé, aucun appel fournisseur", async () => {
    await handleBackofficeMessage(voiceMsg(), voiceDeps({ bytes: new TextEncoder().encode("<script>alert(1)</script>") }));
    expect(lastText()).toMatch(/format audio/); expect(transcribe).not.toHaveBeenCalled();
  });
  it("transcription indisponible ou limitée : message clair, agent non appelé", async () => {
    const { SpeechUnavailableError } = await import("@/domain/ports/speech-port");
    transcribe.mockRejectedValue(new SpeechUnavailableError());
    await handleBackofficeMessage(voiceMsg(), voiceDeps());
    expect(lastText()).toMatch(/pas disponible/);
    await handleBackofficeMessage(voiceMsg(), voiceDeps({ rate: 20 }));
    expect(lastText()).toMatch(/Trop de vocaux/);
    expect(runtimeTexts).toHaveLength(0);
  });
  it("Telegram non relié ou groupe : le vocal n'est ni téléchargé ni transcrit", async () => {
    db = new FakeDb();
    expect(await handleBackofficeMessage(voiceMsg(), voiceDeps())).toBe(false);
    db.seed("channel_identities", [identity()]);
    expect(await handleBackofficeMessage(voiceMsg({}, { chat: { id: -100, type: "group" } }), voiceDeps())).toBe(false);
    expect(downloads).toHaveLength(0); expect(transcribe).not.toHaveBeenCalled();
  });
  it("photo ou autre média : redirigé vers le tableau de bord", async () => {
    await handleBackofficeMessage({ message_id: 3, from: { id: TG, is_bot: false, first_name: "M" }, chat: { id: TG, type: "private" }, date: 0 }, voiceDeps());
    expect(lastText()).toMatch(/tableau de bord/); expect(transcribe).not.toHaveBeenCalled();
  });
});
