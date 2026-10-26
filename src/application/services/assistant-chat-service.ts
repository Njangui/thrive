import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getAgentRuntime } from "@/infrastructure/agents/runtime-registry";
import { SupabaseStepUpAdapter } from "@/infrastructure/channels/supabase-step-up-adapter";
import { checkRateLimit } from "@/lib/rate-limit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { AgentActor } from "@/application/channels/actor";
import type { AgentAttachment, AgentEvent, AgentRuntimePort, ApprovalCard, ApprovalOutcome, ToolRisk } from "@/domain/ports/agent-runtime-port";
import type { StepUpPort } from "@/domain/ports/step-up-port";

/**
 * Chat propriétaire du dashboard (C2, étape 2) : fils, historique, tour d'agent
 * streamé, décisions d'approbation.
 *
 * Isolation : service_role + filtres explicites `organization_id` ET `user_id`
 * sur CHAQUE requête (principe 5). Un fil n'est jamais lisible par un autre
 * membre, owner compris.
 *
 * Confiance : le texte de l'utilisateur et tout ce qu'il colle (message client
 * transféré…) part au runtime comme DONNÉE. Le rendu client n'interprète jamais
 * de HTML (texte brut).
 */
export const MAX_MESSAGE_CHARS = 4000;
const HISTORY_WINDOW = 20;
const MAX_STORED_CONTENT = 20000;
const MAX_EDIT_VALUE_CHARS = 500;

export type ApprovalState = "pending" | "approved" | "rejected" | "expired" | "failed" | "replaced";

export type ChatPart =
  | ({ type: "attachment"; url?: string } & AgentAttachment)
  | { type: "tool"; callId: string; tool: string; label: string; risk: ToolRisk; status: "running" | "done" | "failed" }
  | { type: "approval"; card: ApprovalCard; state: ApprovalState };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: ChatPart[];
  status: "streaming" | "complete" | "error" | "aborted";
  createdAt: string;
}
export interface ChatThread { id: string; title: string | null; lastMessageAt: string }

/** Cadres envoyés au client (NDJSON) : événements d'agent + accusé du message utilisateur. */
export type StreamFrame = { type: "user_message"; messageId: string; threadId: string } | AgentEvent;

export interface ChatDeps {
  db: SupabaseClient;
  runtime: AgentRuntimePort;
  stepUp: StepUpPort;
  rateLimit: (userId: string) => Promise<number | null>;
  resolveUrl?: (organizationId: string, path: string) => Promise<string | null>;
  now: () => number;
}

export function defaultChatDeps(): ChatDeps {
  const db = getSupabaseServiceClient();
  return { db, runtime: getAgentRuntime(), stepUp: new SupabaseStepUpAdapter(db), rateLimit: (userId) => checkRateLimit("assistant", userId), now: () => Date.now() };
}

interface ThreadRow { id: string; title: string | null; last_message_at: string }

async function assertThreadOwned(actor: AgentActor, threadId: string, db: SupabaseClient): Promise<ThreadRow> {
  const { data, error } = await db
    .from("assistant_threads").select("id, title, last_message_at")
    .eq("id", threadId).eq("organization_id", actor.tenantId).eq("user_id", actor.userId).is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(`Chat: lecture du fil impossible: ${error.message}`);
  if (!data) throw new NotFoundError("Conversation introuvable");
  return data as ThreadRow;
}

export async function createThread(actor: AgentActor, db: SupabaseClient = getSupabaseServiceClient()): Promise<ChatThread> {
  const { data, error } = await db
    .from("assistant_threads")
    .insert({ organization_id: actor.tenantId, membership_id: actor.membershipId, user_id: actor.userId })
    .select("id, title, last_message_at").single();
  if (error || !data) throw new Error(`Chat: création du fil impossible: ${error?.message ?? "inconnue"}`);
  return { id: data.id as string, title: (data.title as string | null) ?? null, lastMessageAt: data.last_message_at as string };
}

/**
 * Fil dédié à un canal externe (titre fixe, ex. « Telegram ») : un seul fil actif
 * par membre et par canal, pour que l'historique et l'idempotence soient ceux du
 * chat dashboard. Filtré par tenant ET utilisateur.
 */
export async function getOrCreateChannelThread(actor: AgentActor, title: string, db: SupabaseClient = getSupabaseServiceClient()): Promise<ChatThread> {
  const { data, error } = await db
    .from("assistant_threads").select("id, title, last_message_at")
    .eq("organization_id", actor.tenantId).eq("user_id", actor.userId).eq("title", title).is("archived_at", null)
    .order("last_message_at", { ascending: false }).limit(1);
  if (error) throw new Error(`Chat: lecture du fil de canal impossible: ${error.message}`);
  const row = ((data ?? []) as ThreadRow[])[0];
  if (row) return { id: row.id, title: row.title, lastMessageAt: row.last_message_at };
  const { data: created, error: createError } = await db
    .from("assistant_threads")
    .insert({ organization_id: actor.tenantId, membership_id: actor.membershipId, user_id: actor.userId, title })
    .select("id, title, last_message_at").single();
  if (createError || !created) throw new Error(`Chat: création du fil de canal impossible: ${createError?.message ?? "inconnue"}`);
  return { id: created.id as string, title, lastMessageAt: created.last_message_at as string };
}

/** Dernier message assistant du fil (pour rattacher les cartes d'approbation d'un tour). */
export async function getLatestAssistantMessageId(actor: AgentActor, threadId: string, db: SupabaseClient = getSupabaseServiceClient()): Promise<string | null> {
  const { data, error } = await db
    .from("assistant_messages").select("id")
    .eq("thread_id", threadId).eq("organization_id", actor.tenantId).eq("user_id", actor.userId).eq("role", "assistant")
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`Chat: lecture du dernier message impossible: ${error.message}`);
  return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null;
}

export async function listThreads(actor: AgentActor, db: SupabaseClient = getSupabaseServiceClient(), limit = 30): Promise<ChatThread[]> {
  const { data, error } = await db
    .from("assistant_threads").select("id, title, last_message_at")
    .eq("organization_id", actor.tenantId).eq("user_id", actor.userId).is("archived_at", null)
    .order("last_message_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Chat: liste des fils impossible: ${error.message}`);
  return ((data ?? []) as ThreadRow[]).map((r) => ({ id: r.id, title: r.title, lastMessageAt: r.last_message_at }));
}

export async function archiveThread(actor: AgentActor, threadId: string, db: SupabaseClient = getSupabaseServiceClient()): Promise<void> {
  await assertThreadOwned(actor, threadId, db);
  const { error } = await db.from("assistant_threads").update({ archived_at: new Date().toISOString() })
    .eq("id", threadId).eq("organization_id", actor.tenantId).eq("user_id", actor.userId);
  if (error) throw new Error(`Chat: archivage impossible: ${error.message}`);
}

interface MessageRow { id: string; role: "user" | "assistant"; content: string; parts: ChatPart[] | null; status: ChatMessage["status"]; created_at: string }
const toChatMessage = (r: MessageRow): ChatMessage => ({ id: r.id, role: r.role, content: r.content, parts: r.parts ?? [], status: r.status, createdAt: r.created_at });

export async function getThreadMessages(
  actor: AgentActor, threadId: string,
  deps: Pick<ChatDeps, "db" | "resolveUrl"> = { db: getSupabaseServiceClient() }, limit = 50,
): Promise<ChatMessage[]> {
  await assertThreadOwned(actor, threadId, deps.db);
  const { data, error } = await deps.db
    .from("assistant_messages").select("id, role, content, parts, status, created_at")
    .eq("thread_id", threadId).eq("organization_id", actor.tenantId).eq("user_id", actor.userId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Chat: lecture des messages impossible: ${error.message}`);
  const messages = ((data ?? []) as MessageRow[]).map(toChatMessage).reverse();
  if (deps.resolveUrl) {
    const resolve = deps.resolveUrl;
    for (const m of messages) for (const part of m.parts) {
      if (part.type === "attachment") part.url = (await resolve(actor.tenantId, part.path).catch(() => null)) ?? undefined;
    }
  }
  return messages;
}

async function insertMessage(
  db: SupabaseClient, actor: AgentActor,
  row: { threadId: string; role: "user" | "assistant"; content: string; parts: ChatPart[]; status: ChatMessage["status"]; clientMessageId?: string; runId?: string },
): Promise<string> {
  const { data, error } = await db.from("assistant_messages").insert({
    thread_id: row.threadId, organization_id: actor.tenantId, user_id: actor.userId, role: row.role,
    content: row.content.slice(0, MAX_STORED_CONTENT), parts: row.parts, status: row.status,
    client_message_id: row.clientMessageId ?? null, run_id: row.runId ?? null,
  }).select("id").single();
  if (error || !data) {
    const wrapped = new Error(`Chat: enregistrement du message impossible: ${error?.message ?? "inconnue"}`);
    (wrapped as Error & { code?: string }).code = (error as { code?: string } | null)?.code;
    throw wrapped;
  }
  return data.id as string;
}

/** Ajoute un message ASSISTANT à un fil (livraison du résultat d'une tâche planifiée, avec ses cartes de validation). */
export async function appendAssistantMessage(
  actor: AgentActor, threadId: string, message: { content: string; parts?: ChatPart[]; runId?: string }, db: SupabaseClient = getSupabaseServiceClient(),
): Promise<string> {
  await assertThreadOwned(actor, threadId, db);
  const id = await insertMessage(db, actor, { threadId, role: "assistant", content: message.content, parts: message.parts ?? [], status: "complete", runId: message.runId });
  await db.from("assistant_threads").update({ last_message_at: new Date().toISOString() }).eq("id", threadId).eq("organization_id", actor.tenantId).eq("user_id", actor.userId);
  return id;
}

export interface StreamTurnInput {
  actor: AgentActor; threadId: string; text: string; attachments?: AgentAttachment[];
  /** UUID client : rend le renvoi sur réseau instable idempotent. */
  clientMessageId?: string; signal?: AbortSignal;
}

/**
 * Le message utilisateur est enregistré AVANT l'appel du runtime (jamais perdu) ;
 * la réponse est enregistrée dans le `finally`, donc aussi quand le client coupe
 * la connexion (statut `aborted`).
 */
export async function* streamAssistantTurn(input: StreamTurnInput, deps: ChatDeps = defaultChatDeps()): AsyncGenerator<StreamFrame> {
  const { actor } = input;
  const text = input.text.trim();
  const attachments = input.attachments ?? [];
  if (!text && attachments.length === 0) throw new ValidationError("Message vide");
  if (text.length > MAX_MESSAGE_CHARS) throw new ValidationError(`Message trop long (${MAX_MESSAGE_CHARS} caractères maximum)`);

  const retryAfter = await deps.rateLimit(actor.userId);
  if (retryAfter !== null) {
    yield { type: "error", code: "rate_limited", message: `Trop de messages. Réessayez dans ${retryAfter} s.` };
    return;
  }

  const thread = await assertThreadOwned(actor, input.threadId, deps.db);

  if (input.clientMessageId) {
    const { data: existing, error } = await deps.db.from("assistant_messages").select("id")
      .eq("thread_id", input.threadId).eq("client_message_id", input.clientMessageId).eq("role", "user").maybeSingle();
    if (error) throw new Error(`Chat: contrôle d'idempotence impossible: ${error.message}`);
    if (existing) {
      yield { type: "user_message", messageId: existing.id as string, threadId: input.threadId };
      yield { type: "done" };
      return;
    }
  }

  const { data: historyRows, error: historyError } = await deps.db
    .from("assistant_messages").select("role, content, created_at")
    .eq("thread_id", input.threadId).eq("organization_id", actor.tenantId).eq("user_id", actor.userId).eq("status", "complete")
    .order("created_at", { ascending: false }).limit(HISTORY_WINDOW);
  if (historyError) throw new Error(`Chat: lecture du contexte impossible: ${historyError.message}`);
  const history = ((historyRows ?? []) as { role: "user" | "assistant"; content: string }[]).map((r) => ({ role: r.role, content: r.content })).reverse();

  let userMessageId: string;
  try {
    userMessageId = await insertMessage(deps.db, actor, {
      threadId: input.threadId, role: "user", content: text,
      parts: attachments.map((a) => ({ type: "attachment" as const, ...a })), status: "complete", clientMessageId: input.clientMessageId,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") { yield { type: "done" }; return; } // course entre deux renvois
    throw error;
  }

  await deps.db.from("assistant_threads")
    .update({ last_message_at: new Date(deps.now()).toISOString(), ...(thread.title ? {} : { title: (text || "Pièce jointe").slice(0, 60) }) })
    .eq("id", input.threadId).eq("organization_id", actor.tenantId).eq("user_id", actor.userId);

  yield { type: "user_message", messageId: userMessageId, threadId: input.threadId };

  let content = "";
  const parts: ChatPart[] = [];
  let status: ChatMessage["status"] = "aborted";
  let runId: string | undefined;
  let errorMessage: string | undefined;

  try {
    for await (const event of deps.runtime.run({ actor, threadId: input.threadId, text, attachments, history, signal: input.signal })) {
      if (event.type === "text_delta") content += event.text;
      else if (event.type === "tool_status") {
        const existing = parts.find((p): p is Extract<ChatPart, { type: "tool" }> => p.type === "tool" && p.callId === event.callId);
        if (existing) existing.status = event.status;
        else parts.push({ type: "tool", callId: event.callId, tool: event.tool, label: event.label, risk: event.risk, status: event.status });
      } else if (event.type === "approval_required") parts.push({ type: "approval", card: event.card, state: "pending" });
      else if (event.type === "done") { status = "complete"; runId = event.runId; }
      else if (event.type === "error") { status = "error"; errorMessage = event.message; }
      yield event;
      if (event.type === "done" || event.type === "error") break;
    }
    if (status === "aborted" && !input.signal?.aborted) status = "complete";
  } catch (error) {
    // Détail réel dans les logs serveur ; message générique au client (section 48).
    console.error("[assistant-chat] runtime en échec:", error);
    status = "error";
    errorMessage = "Une erreur est survenue. Réessayez dans un instant.";
    yield { type: "error", code: "internal", message: errorMessage };
  } finally {
    if (status === "error" && !content) content = errorMessage ?? "";
    if (content || parts.length > 0 || status === "error") {
      try { await insertMessage(deps.db, actor, { threadId: input.threadId, role: "assistant", content, parts, status, runId }); }
      catch (persistError) { console.error("[assistant-chat] réponse non enregistrée:", persistError); }
    }
  }
}

export type DecideInput = { actor: AgentActor; messageId: string; pendingActionId: string } & (
  | { decision: "approve"; pin?: string; linkToken?: string; telegramButton?: boolean }
  | { decision: "reject" }
  | { decision: "edit"; edits: Record<string, string> }
);

export type DecideResult =
  | { ok: true; outcome: ApprovalOutcome }
  | { ok: false; reason: "not_found" | "already_decided" | "expired" | "step_up_required" | "step_up_failed" | "invalid_edits";
      detail?: { stepUpReason?: string; attemptsLeft?: number; lockedUntil?: string } };

const OUTCOME_TO_STATE: Record<ApprovalOutcome["status"], ApprovalState> = { executed: "approved", rejected: "rejected", expired: "expired", failed: "failed", replaced: "replaced" };

export async function decideApprovalFromChat(input: DecideInput, deps: ChatDeps = defaultChatDeps()): Promise<DecideResult> {
  const { actor } = input;
  const { data, error } = await deps.db.from("assistant_messages").select("id, parts")
    .eq("id", input.messageId).eq("organization_id", actor.tenantId).eq("user_id", actor.userId).eq("role", "assistant").maybeSingle();
  if (error) throw new Error(`Chat: lecture du message impossible: ${error.message}`);
  const parts = ((data?.parts as ChatPart[] | undefined) ?? []).map((p) => ({ ...p }));
  const index = parts.findIndex((p) => p.type === "approval" && p.card.pendingActionId === input.pendingActionId);
  if (!data || index === -1) return { ok: false, reason: "not_found" };

  const part = parts[index] as Extract<ChatPart, { type: "approval" }>;
  if (part.state !== "pending") return { ok: false, reason: "already_decided" };
  const persist = async () => {
    const { error: updateError } = await deps.db.from("assistant_messages").update({ parts })
      .eq("id", input.messageId).eq("organization_id", actor.tenantId).eq("user_id", actor.userId);
    if (updateError) console.error("[assistant-chat] état d'approbation non enregistré:", updateError.message);
  };

  if (new Date(part.card.expiresAt).getTime() <= deps.now()) { part.state = "expired"; await persist(); return { ok: false, reason: "expired" }; }

  let stepUpChallengeId: string | undefined;
  if (input.decision === "approve" && part.card.stepUp) {
    const { challengeId, allowedMethods } = part.card.stepUp;
    let result;
    if (input.pin && allowedMethods.includes("pin")) result = await deps.stepUp.approveWithPin({ challengeId, membershipId: actor.membershipId, pin: input.pin });
    else if (input.linkToken && allowedMethods.includes("dashboard_link")) result = await deps.stepUp.approveWithDashboardLink({ linkToken: input.linkToken, userId: actor.userId });
    // Bouton Telegram : uniquement depuis le canal Telegram authentifié ET si le moteur de règles l'a autorisé.
    else if (input.telegramButton && actor.channel === "telegram" && allowedMethods.includes("telegram_button")) result = await deps.stepUp.approveWithTelegramButton({ challengeId, membershipId: actor.membershipId });
    // Défi déjà validé à part (lien dashboard ouvert dans un autre onglet) : on poursuit sans rien redemander.
    else if (await deps.stepUp.isApproved({ challengeId, membershipId: actor.membershipId })) result = { ok: true as const, challengeId, method: "dashboard_link" as const };
    else return { ok: false, reason: "step_up_required" };
    if (!result.ok) return { ok: false, reason: "step_up_failed", detail: { stepUpReason: result.reason, attemptsLeft: result.attemptsLeft, lockedUntil: result.lockedUntil } };
    stepUpChallengeId = challengeId;
  }

  if (input.decision === "edit") {
    const allowed = new Set((part.card.editableFields ?? []).map((f) => f.name));
    const entries = Object.entries(input.edits);
    if (entries.length === 0 || entries.some(([k, v]) => !allowed.has(k) || typeof v !== "string" || v.length > MAX_EDIT_VALUE_CHARS)) return { ok: false, reason: "invalid_edits" };
  }

  const outcome = await deps.runtime.decideApproval(
    input.decision === "approve"
      ? { actor, pendingActionId: input.pendingActionId, decision: "approve", stepUp: stepUpChallengeId ? { challengeId: stepUpChallengeId } : undefined }
      : input.decision === "reject"
        ? { actor, pendingActionId: input.pendingActionId, decision: "reject" }
        : { actor, pendingActionId: input.pendingActionId, decision: "edit", edits: input.edits },
  );

  part.state = OUTCOME_TO_STATE[outcome.status];
  if (outcome.status === "replaced") parts.push({ type: "approval", card: outcome.card, state: "pending" });
  await persist();
  return { ok: true, outcome };
}
