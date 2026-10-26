import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "../../../tests/helpers/fake-supabase";
import { createThread, decideApprovalFromChat, getThreadMessages, listThreads, streamAssistantTurn, type ChatDeps, type StreamFrame } from "./assistant-chat-service";
import type { AgentActor } from "@/application/channels/actor";
import type { AgentEvent, AgentRuntimePort, ApprovalCard, ApprovalOutcome } from "@/domain/ports/agent-runtime-port";
import type { StepUpPort } from "@/domain/ports/step-up-port";

const NOW = Date.parse("2026-10-07T10:00:00Z");
const actor = (over: Partial<AgentActor> = {}): AgentActor => ({ userId: "user-1", tenantId: "org-a", membershipId: "mem-1", role: "manager", extraPermissions: [], channel: "dashboard", ...over });
const OTHER_USER = actor({ userId: "user-2", membershipId: "mem-2" });
const OTHER_TENANT = actor({ tenantId: "org-b" });
const card = (over: Partial<ApprovalCard> = {}): ApprovalCard => ({
  pendingActionId: "pa-1", tool: "orders.refund", title: "Rembourser la commande #12", summary: "5 000 FCFA", risk: "sensitive",
  details: [{ label: "Montant", value: "5 000 FCFA" }], editableFields: [{ name: "amount", label: "Montant", type: "number", value: "5000" }],
  expiresAt: new Date(NOW + 600_000).toISOString(), ...over,
});

let db: FakeDb; let runtimeEvents: AgentEvent[]; let runtimeCalls: Parameters<AgentRuntimePort["run"]>[0][];
let decideCalls: unknown[]; let decideOutcome: ApprovalOutcome; let runtimeThrows: boolean; let rateLimited: number | null;
const stepUp = { approveWithPin: vi.fn(), approveWithDashboardLink: vi.fn(), approveWithTelegramButton: vi.fn(), isApproved: vi.fn() };
const client = () => db as unknown as SupabaseClient;

function deps(): ChatDeps {
  const runtime: AgentRuntimePort = {
    name: "fake",
    async *run(input) { runtimeCalls.push(input); if (runtimeThrows) throw new Error("clé API sk-secret invalide"); for (const e of runtimeEvents) yield e; },
    async decideApproval(i) { decideCalls.push(i); return decideOutcome; },
    async listVisibleTools() { return []; },
  };
  return { db: client(), runtime, stepUp: stepUp as unknown as StepUpPort, rateLimit: async () => rateLimited, now: () => NOW };
}
async function collect(gen: AsyncGenerator<StreamFrame>) { const out: StreamFrame[] = []; for await (const f of gen) out.push(f); return out; }

beforeEach(() => {
  db = new FakeDb();
  db.defaults.assistant_messages = { status: "complete", parts: [] };
  db.defaults.assistant_threads = { last_message_at: "2026-01-01T00:00:00.000Z", title: null, archived_at: null };
  runtimeEvents = [{ type: "text_delta", text: "Bonjour " }, { type: "text_delta", text: "Marc" }, { type: "done", runId: "run-1" }];
  runtimeCalls = []; decideCalls = []; runtimeThrows = false; rateLimited = null;
  decideOutcome = { status: "executed", message: "Remboursement effectué" };
  stepUp.approveWithPin.mockReset(); stepUp.approveWithDashboardLink.mockReset(); stepUp.approveWithTelegramButton.mockReset(); stepUp.isApproved.mockReset().mockResolvedValue(false);
});

describe("fils : isolation", () => {
  it("un membre ne voit que ses fils, dans son tenant", async () => {
    const mine = await createThread(actor(), client());
    await createThread(OTHER_USER, client()); await createThread(OTHER_TENANT, client());
    expect((await listThreads(actor(), client())).map((t) => t.id)).toEqual([mine.id]);
  });
  it("lire ou écrire dans le fil d'un autre membre (même tenant) = introuvable, même pour un owner", async () => {
    const t = await createThread(actor(), client());
    await expect(getThreadMessages(actor({ userId: "user-9", role: "owner" }), t.id, { db: client() })).rejects.toThrow(/introuvable/i);
    await expect(collect(streamAssistantTurn({ actor: OTHER_USER, threadId: t.id, text: "salut" }, deps()))).rejects.toThrow(/introuvable/i);
    expect(db.rows("assistant_messages")).toHaveLength(0);
  });
  it("un autre tenant ne peut pas atteindre le fil", async () => {
    const t = await createThread(actor(), client());
    await expect(getThreadMessages(OTHER_TENANT, t.id, { db: client() })).rejects.toThrow(/introuvable/i);
  });
});

describe("streamAssistantTurn", () => {
  it("enregistre le message utilisateur avant le runtime, relaie les cadres, enregistre la réponse", async () => {
    const t = await createThread(actor(), client());
    const frames = await collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "  Bonjour  " }, deps()));
    expect(frames.map((f) => f.type)).toEqual(["user_message", "text_delta", "text_delta", "done"]);
    const msgs = await getThreadMessages(actor(), t.id, { db: client() });
    expect(msgs.map((m) => [m.role, m.content, m.status])).toEqual([["user", "Bonjour", "complete"], ["assistant", "Bonjour Marc", "complete"]]);
    expect(db.rows("assistant_messages")[1]!.run_id).toBe("run-1");
    expect((await listThreads(actor(), client()))[0]!.title).toBe("Bonjour");
  });
  it("transmet l'acteur authentifié et l'historique SANS le nouveau message", async () => {
    const t = await createThread(actor(), client());
    await collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "premier" }, deps()));
    await collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "second" }, deps()));
    expect(runtimeCalls[1]!.actor).toMatchObject({ userId: "user-1", tenantId: "org-a", role: "manager", channel: "dashboard" });
    expect(runtimeCalls[1]!.history).toEqual([{ role: "user", content: "premier" }, { role: "assistant", content: "Bonjour Marc" }]);
  });
  it("refuse un message vide ou trop long sans rien enregistrer", async () => {
    const t = await createThread(actor(), client());
    await expect(collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "   " }, deps()))).rejects.toThrow(/vide/);
    await expect(collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "x".repeat(4001) }, deps()))).rejects.toThrow(/trop long/);
    expect(db.rows("assistant_messages")).toHaveLength(0);
  });
  it("limite de débit : erreur claire, ni message enregistré ni appel de modèle", async () => {
    const t = await createThread(actor(), client()); rateLimited = 12;
    const frames = await collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "salut" }, deps()));
    expect(frames).toEqual([{ type: "error", code: "rate_limited", message: expect.stringContaining("12 s") }]);
    expect(runtimeCalls).toHaveLength(0); expect(db.rows("assistant_messages")).toHaveLength(0);
  });
  it("idempotence : un renvoi avec le même clientMessageId ne relance pas le modèle", async () => {
    const t = await createThread(actor(), client());
    const clientMessageId = "11111111-1111-4111-8111-111111111111";
    await collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "salut", clientMessageId }, deps()));
    const again = await collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "salut", clientMessageId }, deps()));
    expect(runtimeCalls).toHaveLength(1);
    expect(again.map((f) => f.type)).toEqual(["user_message", "done"]);
    expect(db.rows("assistant_messages").filter((m) => m.role === "user")).toHaveLength(1);
  });
  it("panne du runtime : message générique au client (jamais le détail), erreur enregistrée", async () => {
    const t = await createThread(actor(), client()); runtimeThrows = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const frames = await collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "salut" }, deps()));
    spy.mockRestore();
    expect(frames.find((f) => f.type === "error")).toMatchObject({ code: "internal" });
    expect(JSON.stringify(frames)).not.toContain("sk-secret");
    expect(db.rows("assistant_messages").at(-1)).toMatchObject({ role: "assistant", status: "error" });
    expect(JSON.stringify(db.rows("assistant_messages"))).not.toContain("sk-secret");
  });
  it("runtime indisponible (C1 absent) : erreur affichée et conservée", async () => {
    const t = await createThread(actor(), client());
    runtimeEvents = [{ type: "error", code: "unavailable", message: "L'assistant n'est pas activé." }];
    await collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "salut" }, deps()));
    expect(db.rows("assistant_messages").at(-1)).toMatchObject({ status: "error", content: "L'assistant n'est pas activé." });
  });
  it("le client coupe la connexion : texte partiel conservé, statut `aborted`", async () => {
    const t = await createThread(actor(), client());
    const gen = streamAssistantTurn({ actor: actor(), threadId: t.id, text: "salut" }, deps());
    await gen.next(); await gen.next(); await gen.return(undefined);
    expect(db.rows("assistant_messages").at(-1)).toMatchObject({ role: "assistant", status: "aborted", content: "Bonjour " });
  });
  it("outils et cartes d'approbation sont conservés dans `parts`", async () => {
    const t = await createThread(actor(), client());
    runtimeEvents = [
      { type: "tool_status", callId: "c1", tool: "orders.get", label: "Lecture", risk: "read", status: "running" },
      { type: "tool_status", callId: "c1", tool: "orders.get", label: "Lecture", risk: "read", status: "done" },
      { type: "approval_required", card: card() }, { type: "done" },
    ];
    await collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "rembourse #12" }, deps()));
    const parts = db.rows("assistant_messages").at(-1)!.parts as { type: string; status?: string; state?: string }[];
    expect(parts.map((p) => [p.type, p.status ?? p.state])).toEqual([["tool", "done"], ["approval", "pending"]]);
  });
});

describe("decideApprovalFromChat", () => {
  let messageId: string;
  async function seedCard(c: ApprovalCard = card()) {
    const t = await createThread(actor(), client());
    runtimeEvents = [{ type: "approval_required", card: c }, { type: "done" }];
    await collect(streamAssistantTurn({ actor: actor(), threadId: t.id, text: "rembourse" }, deps()));
    messageId = db.rows("assistant_messages").at(-1)!.id as string;
  }
  const stateOf = () => (db.rows("assistant_messages").find((m) => m.id === messageId)!.parts as { type: string; state: string }[]).filter((p) => p.type === "approval").map((p) => p.state);
  const decide = (over: object, who = actor()) => decideApprovalFromChat({ actor: who, messageId, pendingActionId: "pa-1", decision: "approve", ...over } as Parameters<typeof decideApprovalFromChat>[0], deps());

  it("approuver sans step-up : appelle le runtime, carte approuvée", async () => {
    await seedCard();
    expect(await decide({})).toEqual({ ok: true, outcome: { status: "executed", message: "Remboursement effectué" } });
    expect(decideCalls[0]).toMatchObject({ pendingActionId: "pa-1", decision: "approve" }); expect(stateOf()).toEqual(["approved"]);
  });
  it("une carte déjà décidée ne l'est pas deux fois", async () => {
    await seedCard(); await decide({});
    expect(await decide({})).toEqual({ ok: false, reason: "already_decided" }); expect(decideCalls).toHaveLength(1);
  });
  it("carte sensible sans PIN ni lien => step_up_required, runtime NON appelé", async () => {
    await seedCard(card({ stepUp: { challengeId: "ch-1", allowedMethods: ["pin", "dashboard_link"] } }));
    expect(await decide({})).toEqual({ ok: false, reason: "step_up_required" });
    expect(decideCalls).toHaveLength(0); expect(stateOf()).toEqual(["pending"]);
  });
  it("mauvais PIN : essais restants renvoyés, carte toujours en attente", async () => {
    await seedCard(card({ stepUp: { challengeId: "ch-1", allowedMethods: ["pin"] } }));
    stepUp.approveWithPin.mockResolvedValue({ ok: false, reason: "pin_invalid", attemptsLeft: 3 });
    expect(await decide({ pin: "000999" })).toEqual({ ok: false, reason: "step_up_failed", detail: { stepUpReason: "pin_invalid", attemptsLeft: 3, lockedUntil: undefined } });
    expect(stepUp.approveWithPin).toHaveBeenCalledWith({ challengeId: "ch-1", membershipId: "mem-1", pin: "000999" });
    expect(decideCalls).toHaveLength(0); expect(stateOf()).toEqual(["pending"]);
  });
  it("bon PIN : le runtime reçoit le challengeId validé", async () => {
    await seedCard(card({ stepUp: { challengeId: "ch-1", allowedMethods: ["pin"] } }));
    stepUp.approveWithPin.mockResolvedValue({ ok: true, challengeId: "ch-1", method: "pin" });
    expect((await decide({ pin: "493817" })).ok).toBe(true);
    expect(decideCalls[0]).toMatchObject({ decision: "approve", stepUp: { challengeId: "ch-1" } });
  });
  it("une méthode non autorisée par le moteur de règles est ignorée", async () => {
    await seedCard(card({ stepUp: { challengeId: "ch-1", allowedMethods: ["pin"] } }));
    expect(await decide({ linkToken: "tok" })).toEqual({ ok: false, reason: "step_up_required" });
    expect(stepUp.approveWithDashboardLink).not.toHaveBeenCalled();
  });
  it("défi déjà validé via le lien dashboard : « Valider » dans le chat poursuit sans PIN", async () => {
    await seedCard(card({ stepUp: { challengeId: "ch-1", allowedMethods: ["pin", "dashboard_link"] } }));
    stepUp.isApproved.mockResolvedValue(true);
    expect((await decide({})).ok).toBe(true);
    expect(stepUp.isApproved).toHaveBeenCalledWith({ challengeId: "ch-1", membershipId: "mem-1" });
    expect(decideCalls[0]).toMatchObject({ stepUp: { challengeId: "ch-1" } });
  });
  it("bouton Telegram : accepté depuis Telegram si autorisé, refusé depuis le dashboard ou si non autorisé", async () => {
    await seedCard(card({ risk: "write_reversible", stepUp: { challengeId: "ch-1", allowedMethods: ["telegram_button"] } }));
    stepUp.approveWithTelegramButton.mockResolvedValue({ ok: true, challengeId: "ch-1", method: "telegram_button" });
    expect(await decide({ telegramButton: true })).toEqual({ ok: false, reason: "step_up_required" }); // acteur dashboard
    expect(stepUp.approveWithTelegramButton).not.toHaveBeenCalled();
    expect((await decide({ telegramButton: true }, actor({ channel: "telegram" }))).ok).toBe(true);
    expect(stepUp.approveWithTelegramButton).toHaveBeenCalledWith({ challengeId: "ch-1", membershipId: "mem-1" });
  });
  it("bouton Telegram refusé quand le moteur de règles ne l'autorise pas (remboursement)", async () => {
    await seedCard(card({ stepUp: { challengeId: "ch-1", allowedMethods: ["pin"] } }));
    expect(await decide({ telegramButton: true }, actor({ channel: "telegram" }))).toEqual({ ok: false, reason: "step_up_required" });
    expect(stepUp.approveWithTelegramButton).not.toHaveBeenCalled();
  });
  it("refuser n'exige pas de step-up", async () => {
    await seedCard(card({ stepUp: { challengeId: "ch-1", allowedMethods: ["pin"] } }));
    decideOutcome = { status: "rejected", message: "Action refusée" };
    expect((await decide({ decision: "reject" })).ok).toBe(true); expect(stateOf()).toEqual(["rejected"]);
  });
  it("carte expirée : marquée expirée, runtime non appelé", async () => {
    await seedCard(card({ expiresAt: new Date(NOW - 1000).toISOString() }));
    expect(await decide({})).toEqual({ ok: false, reason: "expired" }); expect(decideCalls).toHaveLength(0); expect(stateOf()).toEqual(["expired"]);
  });
  it("modifier : seuls les champs éditables sont acceptés ; une modification produit une NOUVELLE carte", async () => {
    await seedCard();
    expect(await decide({ decision: "edit", edits: { orderId: "o999" } })).toEqual({ ok: false, reason: "invalid_edits" });
    expect(await decide({ decision: "edit", edits: {} })).toEqual({ ok: false, reason: "invalid_edits" });
    expect(decideCalls).toHaveLength(0);
    decideOutcome = { status: "replaced", message: "Nouvelle validation requise", card: card({ pendingActionId: "pa-2", summary: "3 000 FCFA" }) };
    expect((await decide({ decision: "edit", edits: { amount: "3000" } })).ok).toBe(true); expect(stateOf()).toEqual(["replaced", "pending"]);
  });
  it("autre membre, autre tenant ou pendingActionId étranger : refus", async () => {
    await seedCard();
    for (const who of [OTHER_USER, OTHER_TENANT]) expect(await decide({}, who)).toEqual({ ok: false, reason: "not_found" });
    expect(await decide({ pendingActionId: "pa-ETRANGER" })).toEqual({ ok: false, reason: "not_found" });
    expect(decideCalls).toHaveLength(0);
  });
});
