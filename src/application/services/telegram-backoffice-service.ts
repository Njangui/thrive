import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { SupabaseStepUpAdapter } from "@/infrastructure/channels/supabase-step-up-adapter";
import { TelegramClient } from "@/infrastructure/providers/telegram/client";
import type { TelegramCallbackQuery, TelegramMessage, TelegramSendMessageParams } from "@/infrastructure/providers/telegram/types";
import { checkRateLimit, type RateLimitKind } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { acknowledgeAlert } from "./alert-service";
import { transcribeVoice, transcriptEcho, defaultVoiceDeps, type VoiceDeps } from "./voice-command-service";
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS, voiceMessage } from "@/application/voice/voice-policy";
import { normalizeLinkCode } from "@/application/channels/channel-codes";
import type { AgentActor } from "@/application/channels/actor";
import type { ApprovalCard } from "@/domain/ports/agent-runtime-port";
import {
  consumeChannelLinkCode,
  resolveActor,
  revokeOwnChannelIdentities,
  type ResolveActorResult,
} from "./channel-identity-service";
import {
  decideApprovalFromChat,
  defaultChatDeps,
  getLatestAssistantMessageId,
  getOrCreateChannelThread,
  streamAssistantTurn,
  type ChatDeps,
  type DecideResult,
} from "./assistant-chat-service";

/**
 * Bot Telegram de BACK-OFFICE (C2, étape 3) — même bot plateforme que les
 * affiliés (`TELEGRAM_BOT_TOKEN`), canal AUTHENTIFIÉ par liaison de compte.
 * Séparé des bots tenant (canal client) : aucune donnée ni zone de confiance
 * partagée.
 *
 * Règles de sécurité appliquées ici :
 *  - uniquement les conversations PRIVÉES (jamais de back-office dans un groupe) ;
 *  - l'identité est l'identifiant Telegram NUMÉRIQUE de l'expéditeur (jamais le
 *    @username), résolu en acteur à CHAQUE message (rôle relu, révocation immédiate) ;
 *  - un bouton d'approbation n'est utilisable que par le membre auquel la carte
 *    est destinée, dans son chat privé ;
 *  - le PIN saisi dans le chat est supprimé immédiatement (best-effort) et n'est
 *    jamais journalisé ni stocké ;
 *  - tout texte renvoyé est du texte BRUT (pas de parse_mode) : un message client
 *    cité par l'assistant ne peut pas injecter de mise en forme ni de lien actif.
 */

type TelegramPort = Pick<TelegramClient, "sendMessage" | "editMessageText" | "deleteMessage" | "answerCallbackQuery"> & Partial<Pick<TelegramClient, "getFile" | "downloadFile">>;

export interface BackofficeDeps {
  db: SupabaseClient;
  tg: TelegramPort;
  chat: ChatDeps;
  rateLimit: (kind: RateLimitKind, id: string) => Promise<number | null>;
  now: () => number;
  appUrl: string;
  /** Transcription des vocaux (livrable F) ; défaut : SpeechPort enregistré par C3. */
  voice?: VoiceDeps;
}

export function defaultBackofficeDeps(): BackofficeDeps {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN non configuré — le bot Telegram plateforme est désactivé.");
  const db = getSupabaseServiceClient();
  const chat = defaultChatDeps();
  return { db, tg: new TelegramClient(env.TELEGRAM_BOT_TOKEN), chat: { ...chat, stepUp: new SupabaseStepUpAdapter(db) }, rateLimit: checkRateLimit, now: () => Date.now(), appUrl: env.NEXT_PUBLIC_APP_URL };
}

const CHANNEL_THREAD_TITLE = "Telegram";
const CHUNK = 3800;
const PIN_WAIT_MS = 5 * 60 * 1000;
const RISK_ICON: Record<string, string> = { sensitive: "🔒", write_reversible: "✏️" };

const HELP =
  "Je suis votre assistant de pilotage. Écrivez-moi simplement ce que vous voulez faire (commandes, stock, rendez-vous, dépenses…).\n\n" +
  "Commandes :\n/org — changer d'entreprise\n/deconnecter — délier ce Telegram de votre compte\n/aide — cette aide\n\n" +
  "Vous pouvez aussi m'envoyer un message vocal (2 minutes maximum). Ne dictez jamais votre code PIN.\n\n" +
  "Les actions sensibles (remboursement, changement de prix…) demandent votre validation. Pour modifier une demande, utilisez le tableau de bord.";

function chunkText(text: string): string[] {
  const out: string[] = [];
  for (let rest = text.trim(); rest.length > 0; ) {
    if (rest.length <= CHUNK) { out.push(rest); break; }
    const cut = Math.max(rest.lastIndexOf("\n", CHUNK), rest.lastIndexOf(" ", CHUNK), CHUNK / 2);
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  return out;
}

async function say(deps: BackofficeDeps, chatId: number, text: string, markup?: TelegramSendMessageParams["reply_markup"]): Promise<number | undefined> {
  const parts = chunkText(text); let lastId: number | undefined;
  for (let i = 0; i < parts.length; i++) {
    const sent = await deps.tg.sendMessage({ chat_id: chatId, text: parts[i]!, ...(i === parts.length - 1 && markup ? { reply_markup: markup } : {}) });
    lastId = sent.message_id;
  }
  return lastId;
}

const bestEffort = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { console.warn(`[telegram-backoffice] ${label}:`, e instanceof Error ? e.message : e); } };
const displayLabel = (u: { first_name?: string; username?: string }) => (u.username ? `@${u.username}` : (u.first_name ?? "Telegram")).slice(0, 80);

// --- Résolution ----------------------------------------------------------------

type Resolution =
  | { kind: "actor"; actor: AgentActor }
  | { kind: "unknown" }
  | { kind: "reply"; text: string; markup?: TelegramSendMessageParams["reply_markup"] };

function orgKeyboard(orgs: { organizationId: string; organizationName: string }[]): TelegramSendMessageParams["reply_markup"] {
  return { inline_keyboard: orgs.slice(0, 10).map((o) => [{ text: o.organizationName.slice(0, 40), callback_data: `o:${o.organizationId}` }]) };
}

async function resolve(deps: BackofficeDeps, telegramUserId: number, forceChoice = false): Promise<Resolution> {
  const res: ResolveActorResult = await resolveActor({ channel: "telegram", externalId: telegramUserId }, deps.db);
  if (res.kind === "unknown") return { kind: "unknown" };
  if (res.kind === "tenant_inactive") return { kind: "reply", text: "Cette entreprise est suspendue : le pilotage par chat est désactivé. Contactez le support Flexco." };
  if (res.kind === "resolved") return forceChoice ? { kind: "reply", text: "Ce Telegram n'est lié qu'à une seule entreprise." } : { kind: "actor", actor: res.actor };

  if (!forceChoice) {
    const { data, error } = await deps.db.from("channel_active_org").select("organization_id").eq("channel", "telegram").eq("external_id", String(telegramUserId)).maybeSingle();
    if (error) throw new Error(`Telegram: lecture de l'entreprise active impossible: ${error.message}`);
    const chosen = data?.organization_id as string | undefined;
    if (chosen && res.organizations.some((o) => o.organizationId === chosen)) {
      const again = await resolveActor({ channel: "telegram", externalId: telegramUserId, organizationId: chosen }, deps.db);
      if (again.kind === "resolved") return { kind: "actor", actor: again.actor };
    }
  }
  return { kind: "reply", text: "Ce Telegram est lié à plusieurs entreprises. Laquelle voulez-vous piloter ?", markup: orgKeyboard(res.organizations) };
}

// --- Messages --------------------------------------------------------------------

/** `true` = message traité ici ; `false` = laisser le bot plateforme (affiliés) le traiter. */
export async function handleBackofficeMessage(message: TelegramMessage, deps: BackofficeDeps = defaultBackofficeDeps()): Promise<boolean> {
  const from = message.from;
  if (!from || from.is_bot) return false;
  const text = (message.text ?? "").trim();
  const [command, ...args] = text.split(/\s+/);
  const cmd = command?.toLowerCase().replace(/@\w+$/, "") ?? "";
  const startArg = cmd === "/start" ? args[0] : undefined;

  // Jamais de back-office hors conversation privée.
  if (message.chat.type !== "private" || message.chat.id !== from.id) {
    if (startArg && normalizeLinkCode(startArg)) {
      await bestEffort("suppression du code dans le groupe", () => deps.tg.deleteMessage(message.chat.id, message.message_id));
      await say(deps, message.chat.id, "⚠️ Ne partagez jamais ce code dans un groupe. Il est inutilisable : générez-en un nouveau dans le tableau de bord et envoyez-le au bot en conversation privée.");
      return true;
    }
    return false;
  }

  if ((await deps.rateLimit("telegram_backoffice", String(from.id))) !== null) return true; // flood : silence

  const chatId = message.chat.id;

  if (cmd === "/start" && startArg) {
    if (!normalizeLinkCode(startArg)) return false; // jeton affilié : flux existant
    if ((await deps.rateLimit("channel_link", String(from.id))) !== null) { await say(deps, chatId, "Trop de tentatives. Patientez une minute avant de réessayer."); return true; }
    const result = await consumeChannelLinkCode({ code: startArg, channel: "telegram", externalId: from.id, label: displayLabel(from) }, deps.db);
    if (result.ok) {
      await bestEffort("suppression du code", () => deps.tg.deleteMessage(chatId, message.message_id));
      await say(deps, chatId, "✅ Compte relié. Vous pouvez maintenant me parler ici.\n\nGardez ce chat privé : toute personne qui y a accès peut piloter l'entreprise selon vos droits. Tapez /aide pour les commandes.");
      return true;
    }
    if (result.reason === "invalid_code") return false; // peut être un jeton affilié
    const reasons = { code_consumed: "Ce code a déjà été utilisé. Générez-en un nouveau.", code_expired: "Ce code a expiré. Générez-en un nouveau dans le tableau de bord.", identity_already_linked: "Ce Telegram est déjà relié à un autre membre de cette entreprise. Demandez à un administrateur de le délier.", invalid_identifier: "Identifiant Telegram invalide." } as const;
    await say(deps, chatId, reasons[result.reason]);
    return true;
  }

  const resolution = await resolve(deps, from.id, cmd === "/org");
  if (resolution.kind === "unknown") {
    if (cmd.startsWith("/") || !text) return false; // commandes affiliés (/mystats, /help…)
    await say(deps, chatId, "Ce Telegram n'est relié à aucun compte. Dans le tableau de bord, ouvrez Sécurité > Relier Telegram.");
    return true;
  }
  if (resolution.kind === "reply") { await say(deps, chatId, resolution.text, resolution.markup); return true; }
  const { actor } = resolution;

  if (cmd === "/start") { await say(deps, chatId, "Bonjour ! Écrivez-moi votre demande, ou tapez /aide."); return true; }
  if (cmd === "/aide" || cmd === "/help") { await say(deps, chatId, HELP); return true; }
  if (cmd === "/org") { await say(deps, chatId, "Ce Telegram n'est lié qu'à une seule entreprise."); return true; }
  if (cmd === "/deconnecter") {
    const n = await revokeOwnChannelIdentities({ channel: "telegram", externalId: from.id }, deps.db);
    await say(deps, chatId, n > 0 ? "Telegram délié de votre compte. Pour le relier de nouveau, générez un nouveau code dans le tableau de bord." : "Aucun lien à supprimer.");
    return true;
  }
  if (cmd.startsWith("/")) { await say(deps, chatId, "Commande inconnue. Tapez /aide."); return true; }
  if (!text) {
    const voice = message.voice ?? message.audio;
    if (!voice) { await say(deps, chatId, "Je comprends le texte et les messages vocaux. Pour les photos, utilisez le tableau de bord."); return true; }
    const heard = await hearVoice(deps, actor, chatId, message, voice);
    if (heard === null) return true;
    await say(deps, chatId, transcriptEcho(heard));
    await runAgentTurn(deps, actor, chatId, heard);
    return true;
  }

  if (/^\d{6,8}$/.test(text) && (await handlePossiblePin(deps, actor, message, text))) return true;

  await runAgentTurn(deps, actor, chatId, text);
  return true;
}

/**
 * Vocal Telegram → texte. `null` = message déjà expliqué à l'utilisateur, rien à exécuter.
 * Le vocal ne valide JAMAIS une action : le texte obtenu suit le chemin d'un message tapé.
 */
async function hearVoice(deps: BackofficeDeps, actor: AgentActor, chatId: number, message: TelegramMessage, voice: { file_id: string; duration?: number; file_size?: number }): Promise<string | null> {
  // Contrôles AVANT téléchargement (métadonnées Telegram) : pas de transfert inutile.
  if (voice.file_size !== undefined && voice.file_size > MAX_VOICE_BYTES) { await say(deps, chatId, voiceMessage("too_large")); return null; }
  if (voice.duration !== undefined && voice.duration > MAX_VOICE_SECONDS) { await say(deps, chatId, voiceMessage("too_long")); return null; }
  if (!deps.tg.getFile || !deps.tg.downloadFile) { await say(deps, chatId, voiceMessage("unavailable")); return null; }
  let bytes: Uint8Array;
  try {
    const file = await deps.tg.getFile(voice.file_id);
    if (!file.file_path) throw new Error("chemin de fichier absent");
    bytes = (await deps.tg.downloadFile(file.file_path)).data;
  } catch (error) {
    console.warn("[telegram-backoffice] téléchargement du vocal impossible:", error instanceof Error ? error.message : error);
    await say(deps, chatId, voiceMessage("failed")); return null;
  }
  const result = await transcribeVoice({ actor, source: "telegram", bytes, durationSec: voice.duration }, deps.voice ?? defaultVoiceDeps());
  if (result.ok) return result.text;
  if (result.reason === "secret_dictated") await bestEffort("suppression du vocal contenant un code", () => deps.tg.deleteMessage(chatId, message.message_id));
  await say(deps, chatId, result.message);
  return null;
}

async function runAgentTurn(deps: BackofficeDeps, actor: AgentActor, chatId: number, text: string): Promise<void> {
  let reply = ""; let errorText: string | undefined; const cards: ApprovalCard[] = [];
  const thread = await getOrCreateChannelThread(actor, CHANNEL_THREAD_TITLE, deps.db);
  try {
    for await (const frame of streamAssistantTurn({ actor, threadId: thread.id, text }, deps.chat)) {
      if (frame.type === "text_delta") reply += frame.text;
      else if (frame.type === "approval_required") cards.push(frame.card);
      else if (frame.type === "error") errorText = frame.message;
    }
  } catch (error) {
    if (error instanceof AppError && error.kind === "validation") { await say(deps, chatId, error.message); return; }
    throw error;
  }
  const body = reply.trim() || (cards.length === 0 ? (errorText ?? "Je n'ai pas de réponse pour le moment.") : "");
  if (body) await say(deps, chatId, body);
  if (cards.length > 0) {
    const messageId = await getLatestAssistantMessageId(actor, thread.id, deps.db);
    for (const card of cards) await sendApprovalPrompt(deps, actor, chatId, messageId, card);
  }
}

async function sendApprovalPrompt(deps: BackofficeDeps, actor: AgentActor, chatId: number, assistantMessageId: string | null, card: ApprovalCard): Promise<void> {
  const methods = card.stepUp?.allowedMethods ?? [];
  const cardText =
    `${RISK_ICON[card.risk] ?? ""} ${card.title}\n${card.summary}\n\n` +
    card.details.map((d) => `${d.label} : ${d.value}`).join("\n") +
    `\n\nExpire à ${new Date(card.expiresAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Douala" })}`;

  const { data, error } = await deps.db.from("channel_approval_prompts").insert({
    organization_id: actor.tenantId, membership_id: actor.membershipId, channel: "telegram", chat_id: String(chatId),
    assistant_message_id: assistantMessageId, pending_action_id: card.pendingActionId, challenge_id: card.stepUp?.challengeId ?? null,
    allowed_methods: methods, card_text: cardText, expires_at: card.expiresAt,
  }).select("id").single();
  if (error || !data) throw new Error(`Telegram: enregistrement de la carte impossible: ${error?.message ?? "inconnue"}`);
  const promptId = data.id as string;

  const row: { text: string; url?: string; callback_data?: string }[] = [
    { text: methods.includes("pin") && !methods.includes("telegram_button") ? "✅ Valider (PIN)" : "✅ Valider", callback_data: `ap:y:${promptId}` },
    { text: "❌ Refuser", callback_data: `ap:n:${promptId}` },
  ];
  const keyboard = [row];
  if (methods.includes("dashboard_link") && card.stepUp?.linkToken) keyboard.push([{ text: "Valider sur le tableau de bord", url: `${deps.appUrl}/dashboard/approve/${card.stepUp.linkToken}` }]);
  const sentId = await say(deps, chatId, cardText, { inline_keyboard: keyboard });
  if (sentId !== undefined) await deps.db.from("channel_approval_prompts").update({ channel_message_id: String(sentId) }).eq("id", promptId).eq("membership_id", actor.membershipId);
}

// --- PIN saisi dans le chat ---------------------------------------------------------

async function handlePossiblePin(deps: BackofficeDeps, actor: AgentActor, message: TelegramMessage, pin: string): Promise<boolean> {
  const nowIso = new Date(deps.now()).toISOString();
  const { data, error } = await deps.db.from("channel_approval_prompts").select("id, assistant_message_id, pending_action_id, channel_message_id, card_text")
    .eq("membership_id", actor.membershipId).eq("organization_id", actor.tenantId).eq("chat_id", String(message.chat.id)).eq("status", "awaiting_pin").gt("awaiting_pin_until", nowIso)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`Telegram: lecture de la carte en attente impossible: ${error.message}`);
  const prompt = (data ?? [])[0] as { id: string; assistant_message_id: string | null; pending_action_id: string; channel_message_id: string | null; card_text: string | null } | undefined;
  if (!prompt) return false; // chiffres sans carte en attente : message ordinaire

  // Le PIN ne doit pas rester dans l'historique du chat.
  await bestEffort("suppression du PIN", () => deps.tg.deleteMessage(message.chat.id, message.message_id));
  if (!prompt.assistant_message_id) { await say(deps, message.chat.id, "Cette demande n'est plus disponible. Reformulez-la."); return true; }

  const result = await decideApprovalFromChat({ actor, messageId: prompt.assistant_message_id, pendingActionId: prompt.pending_action_id, decision: "approve", pin }, deps.chat);
  if (!result.ok && result.reason === "step_up_failed") {
    const d = result.detail;
    if (d?.stepUpReason === "locked") await finalizePrompt(deps, actor, prompt.id, "open");
    await say(deps, message.chat.id, stepUpMessage(d));
    return true;
  }
  const outcome = describe(result);
  await finalizePrompt(deps, actor, prompt.id, "done");
  if (prompt.channel_message_id) await bestEffort("figer la carte", () => deps.tg.editMessageText({ chat_id: message.chat.id, message_id: Number(prompt.channel_message_id), text: `${prompt.card_text ?? "Demande"}\n\n${outcome}` }));
  await say(deps, message.chat.id, outcome);
  return true;
}

async function finalizePrompt(deps: BackofficeDeps, actor: AgentActor, id: string, status: "open" | "done" | "expired" | "awaiting_pin", awaitingUntil?: string): Promise<void> {
  const { error } = await deps.db.from("channel_approval_prompts").update({ status, awaiting_pin_until: awaitingUntil ?? null }).eq("id", id).eq("membership_id", actor.membershipId).eq("organization_id", actor.tenantId);
  if (error) console.error("[telegram-backoffice] état de la carte non enregistré:", error.message);
}

function stepUpMessage(d?: { stepUpReason?: string; attemptsLeft?: number; lockedUntil?: string }): string {
  if (d?.stepUpReason === "locked") return "🔒 PIN verrouillé temporairement après trop d'essais. Réessayez plus tard ou validez depuis le tableau de bord.";
  if (d?.stepUpReason === "pin_not_set") return "Aucun PIN défini. Définissez-le dans le tableau de bord (Sécurité).";
  if (d?.stepUpReason === "pin_invalid") return `PIN incorrect. ${d.attemptsLeft ?? 0} essai(s) restant(s). Renvoyez votre PIN.`;
  return "Validation refusée.";
}

function describe(result: DecideResult): string {
  if (result.ok) {
    const { status, message } = result.outcome;
    return status === "executed" ? `✅ ${message}` : status === "rejected" ? "❌ Demande refusée." : status === "expired" ? "⌛ Demande expirée." : status === "replaced" ? `ℹ️ ${message}` : `⚠️ ${message}`;
  }
  const m: Record<string, string> = { not_found: "Demande introuvable.", already_decided: "Cette demande a déjà été traitée.", expired: "⌛ Cette demande a expiré.", step_up_required: "Validation renforcée requise.", step_up_failed: "Validation refusée.", invalid_edits: "Modification invalide." };
  return m[result.reason] ?? "Action impossible.";
}

// --- Boutons -------------------------------------------------------------------------

/** `true` = traité ici ; `false` = pas notre `callback_data`. */
export async function handleBackofficeCallback(cb: TelegramCallbackQuery, deps: BackofficeDeps = defaultBackofficeDeps()): Promise<boolean> {
  const data = cb.data ?? "";
  if (!data.startsWith("ap:") && !data.startsWith("o:") && !data.startsWith("al:")) return false;
  const chat = cb.message?.chat;
  if (!chat || chat.type !== "private" || chat.id !== cb.from.id) { await bestEffort("callback", () => deps.tg.answerCallbackQuery(cb.id, "Indisponible ici.", true)); return true; }
  if ((await deps.rateLimit("telegram_backoffice", String(cb.from.id))) !== null) { await bestEffort("callback", () => deps.tg.answerCallbackQuery(cb.id)); return true; }
  const answer = (text?: string, alert = false) => bestEffort("réponse au bouton", () => deps.tg.answerCallbackQuery(cb.id, text, alert));

  // Accusé de réception d'une alerte (« J'ai vu ») : stoppe l'escalade. L'acteur est résolu
  // dans l'entreprise DE L'ALERTE ; message inconnu, autre membre ou rôle insuffisant => même refus.
  if (data.startsWith("al:a:")) {
    const alertId = data.slice(5);
    const { data: a } = await deps.db.from("alerts").select("organization_id").eq("id", alertId).maybeSingle();
    const orgId = (a as { organization_id: string } | null)?.organization_id;
    const res = orgId ? await resolveActor({ channel: "telegram", externalId: cb.from.id, organizationId: orgId }, deps.db) : null;
    if (!orgId || !res || res.kind !== "resolved") { await answer("Action non autorisée.", true); return true; }
    const ack = await acknowledgeAlert({ alertId, organizationId: orgId, membershipId: res.actor.membershipId, via: "telegram" }, { db: deps.db, now: deps.now });
    if (!ack.ok) { await answer("Action non autorisée.", true); return true; }
    await answer(ack.alreadyDone ? "Déjà pris en compte." : "Alerte prise en compte.");
    if (cb.message) await bestEffort("figer l'alerte", () => deps.tg.editMessageText({ chat_id: chat.id, message_id: cb.message!.message_id, text: `${cb.message?.text ?? "Alerte"}\n\n✅ Prise en compte.` }));
    return true;
  }

  // Changement d'entreprise.
  if (data.startsWith("o:")) {
    const orgId = data.slice(2);
    const res = await resolveActor({ channel: "telegram", externalId: cb.from.id, organizationId: orgId }, deps.db);
    if (res.kind !== "resolved") { await answer("Entreprise indisponible.", true); return true; }
    const { error } = await deps.db.from("channel_active_org").upsert({ channel: "telegram", external_id: String(cb.from.id), organization_id: orgId, updated_at: new Date(deps.now()).toISOString() }, { onConflict: "channel,external_id" });
    if (error) throw new Error(`Telegram: enregistrement de l'entreprise active impossible: ${error.message}`);
    await answer("Entreprise active mise à jour.");
    if (cb.message) await bestEffort("figer le choix", () => deps.tg.editMessageText({ chat_id: chat.id, message_id: cb.message!.message_id, text: "Entreprise active mise à jour. Vous pouvez écrire." }));
    return true;
  }

  const [, verb, promptId] = data.split(":");
  if (!promptId || (verb !== "y" && verb !== "n")) { await answer(); return true; }
  const { data: row, error } = await deps.db.from("channel_approval_prompts").select("id, organization_id, membership_id, chat_id, assistant_message_id, pending_action_id, allowed_methods, status, expires_at, card_text, channel_message_id").eq("id", promptId).maybeSingle();
  if (error) throw new Error(`Telegram: lecture de la carte impossible: ${error.message}`);
  const prompt = row as { id: string; organization_id: string; membership_id: string; chat_id: string; assistant_message_id: string | null; pending_action_id: string; allowed_methods: string[]; status: string; expires_at: string; card_text: string | null; channel_message_id: string | null } | null;

  // Carte inconnue OU destinée à un autre membre / autre chat : même réponse (aucune fuite d'existence).
  const res = prompt && prompt.chat_id === String(cb.from.id) ? await resolveActor({ channel: "telegram", externalId: cb.from.id, organizationId: prompt.organization_id }, deps.db) : null;
  if (!prompt || !res || res.kind !== "resolved" || res.actor.membershipId !== prompt.membership_id) { await answer("Action non autorisée.", true); return true; }
  const actor = res.actor;

  if (prompt.status === "done" || prompt.status === "expired") { await answer("Déjà traitée."); return true; }
  const freeze = (text: string) => cb.message && bestEffort("figer la carte", () => deps.tg.editMessageText({ chat_id: chat.id, message_id: cb.message!.message_id, text: `${prompt.card_text ?? cb.message?.text ?? "Demande"}\n\n${text}` }));
  if (new Date(prompt.expires_at).getTime() <= deps.now()) { await finalizePrompt(deps, actor, prompt.id, "expired"); await answer("Demande expirée.", true); await freeze("⌛ Demande expirée."); return true; }
  if (!prompt.assistant_message_id) { await answer("Demande indisponible. Reformulez-la.", true); return true; }

  if (verb === "n") {
    const r = await decideApprovalFromChat({ actor, messageId: prompt.assistant_message_id, pendingActionId: prompt.pending_action_id, decision: "reject" }, deps.chat);
    await finalizePrompt(deps, actor, prompt.id, "done"); await answer(r.ok ? "Refusée." : describe(r)); await freeze(describe(r));
    return true;
  }

  const r = await decideApprovalFromChat({ actor, messageId: prompt.assistant_message_id, pendingActionId: prompt.pending_action_id, decision: "approve", telegramButton: prompt.allowed_methods.includes("telegram_button") }, deps.chat);
  if (!r.ok && r.reason === "step_up_required") {
    if (prompt.allowed_methods.includes("pin")) {
      await finalizePrompt(deps, actor, prompt.id, "awaiting_pin", new Date(deps.now() + PIN_WAIT_MS).toISOString());
      await answer("Envoyez votre PIN.");
      await say(deps, chat.id, "🔐 Répondez avec votre PIN (6 à 8 chiffres). Je supprime votre message dès réception.");
    } else await answer("Validez depuis le bouton « tableau de bord ».", true);
    return true;
  }
  if (!r.ok && r.reason === "step_up_failed") { await answer(stepUpMessage(r.detail), true); return true; }
  await finalizePrompt(deps, actor, prompt.id, "done"); await answer(r.ok ? "Fait." : describe(r)); await freeze(describe(r));
  return true;
}
