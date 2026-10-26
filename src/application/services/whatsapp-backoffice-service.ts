import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { SupabaseStepUpAdapter } from "@/infrastructure/channels/supabase-step-up-adapter";
import { getMessagingProviderForChannel } from "@/infrastructure/providers/registry";
import type { OutboundMessage } from "@/domain/ports/messaging-provider";
import { checkRateLimit, type RateLimitKind } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { normalizeExternalId } from "@/application/channels/channel-codes";
import type { AgentActor } from "@/application/channels/actor";
import type { ApprovalCard } from "@/domain/ports/agent-runtime-port";
import { consumeChannelLinkCode, resolveActor, revokeOwnChannelIdentities } from "./channel-identity-service";
import { getOrCreateChannelThread, streamAssistantTurn, defaultChatDeps, type ChatDeps } from "./assistant-chat-service";
import { acknowledgeAlert } from "./alert-service";
import { transcribeVoice, transcriptEcho, defaultVoiceDeps, type VoiceDeps } from "./voice-command-service";
import { MAX_VOICE_BYTES, voiceMessage } from "@/application/voice/voice-policy";
import { downloadRemoteMedia } from "@/lib/remote-media";

/**
 * Back-office WhatsApp (C2, étape 5) via Zernio.
 *
 * Le numéro WhatsApp du tenant est PUBLIC : n'importe qui peut lui écrire. Règles :
 *  - le personnel est identifié par son NUMÉRO (fourni par Meta/Zernio dans le webhook signé, jamais
 *    par le texte du message), relié à un membership par un code à usage unique envoyé DEPUIS ce numéro
 *    (`LIER CODE`) : prouver la possession du numéro ;
 *  - rôle relu à chaque message, révocation immédiate (comme Telegram) ;
 *  - mode partagé : un message d'un numéro NON lié (ou back-office désactivé) est rendu au pipeline
 *    client (C3) ; mode dédié : un numéro non lié reçoit un refus et n'atteint JAMAIS le pipeline client ;
 *  - ÉCHANGE DE SIM : un attaquant qui prend le numéro devient « le membre ». Donc AUCUNE action
 *    sensible ne se valide sur WhatsApp : ni PIN (un message WhatsApp ne peut pas être supprimé du
 *    chat), ni bouton. La carte renvoie vers le tableau de bord (session + PIN/lien) ;
 *  - texte brut uniquement ; contenu client cité = donnée non fiable.
 */

export interface WhatsAppInbound {
  organizationId: string;
  accountId?: string;
  conversationId: string;
  phoneE164?: string;
  text: string;
  hasAttachment: boolean;
  attachmentType?: "image" | "video" | "audio" | "file";
  /** URL du média telle que fournie par Zernio (vocaux : relue UNIQUEMENT depuis les hôtes autorisés). */
  attachmentUrl?: string;
}
export type RouteResult = "handled" | "not_backoffice";

export interface WhatsAppBackofficeDeps {
  db: SupabaseClient;
  chat: ChatDeps;
  rateLimit: (kind: RateLimitKind, id: string) => Promise<number | null>;
  now: () => number;
  appUrl: string;
  /** Transcription des vocaux (livrable F) ; défaut : SpeechPort enregistré par C3. */
  voice?: VoiceDeps;
  /** Téléchargement d'un média distant (liste blanche d'hôtes, taille plafonnée). */
  downloadMedia?: (url: string, maxBytes: number) => Promise<{ data: Uint8Array }>;
  reply: (organizationId: string, accountId: string | undefined, message: OutboundMessage) => Promise<void>;
}

export function defaultWhatsAppBackofficeDeps(): WhatsAppBackofficeDeps {
  const db = getSupabaseServiceClient();
  const chat = defaultChatDeps();
  return {
    db, chat: { ...chat, stepUp: new SupabaseStepUpAdapter(db) }, rateLimit: checkRateLimit, now: () => Date.now(), appUrl: env.NEXT_PUBLIC_APP_URL,
    reply: async (org, accountId, message) => { await (await getMessagingProviderForChannel(org, "whatsapp", accountId)).sendMessage(org, message); },
  };
}

const CHUNK = 3800;
const HELP =
  "Je suis votre assistant de pilotage. Écrivez-moi ce que vous voulez faire (commandes, stock, rendez-vous, dépenses…).\n\n" +
  "Commandes : AIDE · VU (confirmer une alerte) · DECONNECTER (délier ce numéro)\n\nVous pouvez aussi envoyer un message vocal (2 minutes maximum). Ne dictez jamais votre code PIN.\n\n" +
  "Les actions sensibles (remboursement, changement de prix…) se valident depuis votre tableau de bord.";
const REFUSAL = "Ce numéro est réservé au pilotage de l'entreprise. Pour le relier, générez un code dans le tableau de bord (Sécurité) puis envoyez : LIER VOTRECODE.";
const RISK_ICON: Record<string, string> = { sensitive: "🔒", write_reversible: "✏️" };

function chunkText(text: string): string[] {
  const out: string[] = [];
  for (let rest = text.trim(); rest.length > 0; ) {
    if (rest.length <= CHUNK) { out.push(rest); break; }
    const cut = Math.max(rest.lastIndexOf("\n", CHUNK), rest.lastIndexOf(" ", CHUNK), CHUNK / 2);
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  return out;
}

const LINK_RE = /^\s*(?:lier|link)\s+([A-Za-z0-9-]{8,20})\s*$/i;
const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

export async function handleWhatsAppBackoffice(input: WhatsAppInbound, deps: WhatsAppBackofficeDeps = defaultWhatsAppBackofficeDeps()): Promise<RouteResult> {
  const org = input.organizationId;
  const { data: st, error: stErr } = await deps.db.from("whatsapp_backoffice_settings").select("enabled, dedicated_account_id").eq("organization_id", org).maybeSingle();
  if (stErr) throw new Error(`WhatsApp back-office: lecture des réglages impossible: ${stErr.message}`);
  const settings = st as { enabled: boolean; dedicated_account_id: string | null } | null;
  const dedicated = Boolean(settings?.dedicated_account_id && settings.dedicated_account_id === input.accountId);
  if (!settings?.enabled && !dedicated) return "not_backoffice";

  const say = async (text: string, button?: { text: string; url: string }) => {
    const parts = chunkText(text);
    for (let i = 0; i < parts.length; i++) {
      await deps.reply(org, input.accountId, { to: input.phoneE164 ?? "", channel: "whatsapp", content: parts[i]!, externalThreadId: input.conversationId, ...(i === parts.length - 1 && button ? { buttons: [button] } : {}) });
    }
  };

  const phone = input.phoneE164 ? normalizeExternalId("whatsapp", input.phoneE164) : null;
  if (!phone) { if (dedicated) { await say(REFUSAL); return "handled"; } return "not_backoffice"; }

  // Liaison : le code est consommé avec le numéro de l'EXPÉDITEUR (transport), jamais un numéro saisi.
  const link = LINK_RE.exec(input.text);
  if (link) {
    if ((await deps.rateLimit("channel_link", phone)) !== null) return "handled";
    const res = await consumeChannelLinkCode({ code: link[1]!, channel: "whatsapp", externalId: phone, label: phone.slice(0, 4) + "…" + phone.slice(-2) }, deps.db);
    if (res.ok) {
      if (res.organizationId === org) {
        await recordInbound(deps, org, phone, input);
        await say("✅ Numéro relié. Vous pouvez maintenant me parler comme dans le tableau de bord. Tapez AIDE pour les commandes.");
      } else await say("✅ Numéro relié. Écrivez au numéro WhatsApp de l'entreprise concernée pour la piloter.");
    } else {
      const m: Record<string, string> = { code_consumed: "Ce code a déjà été utilisé.", code_expired: "Ce code a expiré. Générez-en un nouveau.", identity_already_linked: "Ce numéro est déjà relié à une entreprise.", invalid_identifier: "Numéro non reconnu." };
      await say(m[res.reason] ?? "Code invalide. Générez-en un nouveau dans le tableau de bord (Sécurité).");
    }
    return "handled";
  }

  const res = await resolveActor({ channel: "whatsapp", externalId: phone, organizationId: org }, deps.db);
  if (res.kind !== "resolved") {
    if (!dedicated) return "not_backoffice";
    if ((await deps.rateLimit("whatsapp_backoffice", phone)) === null) await say(REFUSAL);
    return "handled";
  }
  const actor = res.actor;
  if ((await deps.rateLimit("whatsapp_backoffice", phone)) !== null) return "handled";
  await recordInbound(deps, org, phone, input);

  const cmd = stripAccents(input.text.trim().toLowerCase()).replace(/^\//, "");
  if (cmd === "aide" || cmd === "help") { await say(HELP); return "handled"; }
  if (cmd === "deconnecter") {
    const n = await revokeOwnChannelIdentities({ channel: "whatsapp", externalId: phone }, deps.db);
    await say(n > 0 ? "Numéro délié de votre compte. Pour le relier de nouveau, générez un nouveau code dans le tableau de bord." : "Aucun lien à supprimer.");
    return "handled";
  }
  if (cmd === "vu") { await say(await ackLatestAlert(deps, actor)); return "handled"; }

  if (input.hasAttachment && !input.text.trim()) {
    if (input.attachmentType !== "audio") { await say("Je ne traite pas les pièces jointes ici. Envoyez-les depuis le tableau de bord."); return "handled"; }
    const heard = await hearVoice(deps, actor, input, say);
    if (heard === null) return "handled";
    await say(transcriptEcho(heard));
    await runAgentTurn(deps, actor, { ...input, text: heard }, say);
    return "handled";
  }
  if (!input.text.trim()) return "handled";
  await runAgentTurn(deps, actor, input, say);
  return "handled";
}

/**
 * Vocal WhatsApp → texte. `null` = message déjà expliqué, rien à exécuter. Aucune validation par
 * vocal (ni PIN, ni « oui ») : le texte obtenu suit le chemin d'un message tapé, et les actions
 * sensibles restent validées depuis le tableau de bord.
 */
async function hearVoice(deps: WhatsAppBackofficeDeps, actor: AgentActor, input: WhatsAppInbound, say: (t: string) => Promise<void>): Promise<string | null> {
  if (!input.attachmentUrl) { await say(voiceMessage("failed")); return null; }
  let bytes: Uint8Array;
  try {
    bytes = (await (deps.downloadMedia ?? downloadRemoteMedia)(input.attachmentUrl, MAX_VOICE_BYTES)).data;
  } catch (error) {
    // Hôte non autorisé, fichier expiré chez Zernio, trop gros : on n'en dit pas plus à l'utilisateur.
    console.warn("[whatsapp-backoffice] téléchargement du vocal impossible:", error instanceof Error ? error.message : error);
    await say(voiceMessage("failed")); return null;
  }
  const result = await transcribeVoice({ actor, source: "whatsapp", bytes }, deps.voice ?? defaultVoiceDeps());
  if (result.ok) return result.text;
  await say(result.message);
  return null;
}

async function recordInbound(deps: WhatsAppBackofficeDeps, org: string, phone: string, input: WhatsAppInbound): Promise<void> {
  const nowIso = new Date(deps.now()).toISOString();
  const { error } = await deps.db.from("channel_identities").update({ last_inbound_at: nowIso, last_seen_at: nowIso, whatsapp_conversation_id: input.conversationId, whatsapp_account_id: input.accountId ?? null })
    .eq("organization_id", org).eq("channel", "whatsapp").eq("external_id", phone).eq("status", "active");
  if (error) console.warn("[whatsapp-backoffice] fenêtre de 24 h non enregistrée:", error.message);
}

async function ackLatestAlert(deps: WhatsAppBackofficeDeps, actor: AgentActor): Promise<string> {
  const { data } = await deps.db.from("alerts").select("id").eq("organization_id", actor.tenantId).eq("status", "open").order("created_at", { ascending: false }).limit(1);
  const id = ((data ?? [])[0] as { id: string } | undefined)?.id;
  if (!id) return "Aucune alerte en cours.";
  const r = await acknowledgeAlert({ alertId: id, organizationId: actor.tenantId, membershipId: actor.membershipId, via: "whatsapp" }, { db: deps.db, now: deps.now });
  return r.ok ? "✅ Alerte prise en compte." : "Vous ne pouvez pas accuser cette alerte.";
}

async function runAgentTurn(deps: WhatsAppBackofficeDeps, actor: AgentActor, input: WhatsAppInbound, say: (t: string, b?: { text: string; url: string }) => Promise<void>): Promise<void> {
  let reply = ""; let errorText: string | undefined; const cards: ApprovalCard[] = [];
  const thread = await getOrCreateChannelThread(actor, "WhatsApp", deps.db);
  try {
    for await (const frame of streamAssistantTurn({ actor, threadId: thread.id, text: input.text }, deps.chat)) {
      if (frame.type === "text_delta") reply += frame.text;
      else if (frame.type === "approval_required") cards.push(frame.card);
      else if (frame.type === "error") errorText = frame.message;
    }
  } catch (error) {
    if (error instanceof AppError && error.kind === "validation") { await say(error.message); return; }
    throw error;
  }
  const body = reply.trim() || (cards.length === 0 ? (errorText ?? "Je n'ai pas de réponse pour le moment.") : "");
  if (body) await say(body);
  for (const card of cards) {
    const text = `${RISK_ICON[card.risk] ?? ""} ${card.title}\n${card.summary}\n\n${card.details.map((d) => `${d.label} : ${d.value}`).join("\n")}\n\nPour votre sécurité, cette action se valide depuis votre tableau de bord.`;
    // Un seul bouton lien : vers la validation par lien si C1 l'a émise, sinon vers l'assistant.
    const url = card.stepUp?.linkToken && card.stepUp.allowedMethods.includes("dashboard_link") ? `${deps.appUrl}/dashboard/approve/${card.stepUp.linkToken}` : `${deps.appUrl}/dashboard/assistant`;
    await say(text, { text: "Ouvrir le tableau de bord", url });
  }
}

// --- Réglages (écran /dashboard/security/whatsapp) ----------------------------------

export interface BackofficeSettingsView {
  enabled: boolean;
  dedicatedAccountId: string | null;
  numbers: { accountId: string; phone: string | null; isPrimary: boolean }[];
}

export async function getBackofficeSettingsView(organizationId: string, db: SupabaseClient = getSupabaseServiceClient()): Promise<BackofficeSettingsView> {
  const [s, n] = await Promise.all([
    db.from("whatsapp_backoffice_settings").select("enabled, dedicated_account_id").eq("organization_id", organizationId).maybeSingle(),
    db.from("whatsapp_accounts").select("account_id, phone_number, is_primary").eq("organization_id", organizationId).eq("status", "connected"),
  ]);
  if (s.error) throw new Error(`WhatsApp back-office: lecture impossible: ${s.error.message}`);
  const row = s.data as { enabled: boolean; dedicated_account_id: string | null } | null;
  return {
    enabled: row?.enabled ?? false, dedicatedAccountId: row?.dedicated_account_id ?? null,
    numbers: ((n.data ?? []) as { account_id: string; phone_number: string | null; is_primary: boolean }[]).map((a) => ({ accountId: a.account_id, phone: a.phone_number, isPrimary: a.is_primary })),
  };
}

/** Propriétaire/admin vérifié par l'appelant. Le numéro dédié doit être un numéro CONNECTÉ de cette entreprise. */
export async function saveBackofficeSettings(organizationId: string, input: { enabled: boolean; dedicatedAccountId: string | null }, db: SupabaseClient = getSupabaseServiceClient()): Promise<void> {
  if (input.dedicatedAccountId) {
    const { data } = await db.from("whatsapp_accounts").select("account_id").eq("organization_id", organizationId).eq("account_id", input.dedicatedAccountId).eq("status", "connected").maybeSingle();
    if (!data) throw new AppError("Ce numéro WhatsApp n'appartient pas à cette entreprise.", 400, "validation");
  }
  const { error } = await db.from("whatsapp_backoffice_settings").upsert({ organization_id: organizationId, enabled: input.enabled, dedicated_account_id: input.dedicatedAccountId }, { onConflict: "organization_id" });
  if (error) throw new Error(`WhatsApp back-office: enregistrement impossible: ${error.message}`);
}
