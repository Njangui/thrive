import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ZernioClient } from "@/infrastructure/providers/messaging/zernio/client";
import { getMessagingProviderForChannel } from "@/infrastructure/providers/registry";
import type { OutboundMessage } from "@/domain/ports/messaging-provider";
import { buildTemplateParams, isSessionWindowOpen, templateByKey, toParticipantId, type TemplateKey } from "@/application/channels/whatsapp-templates";
import type { AlertWhatsAppPort } from "./alert-service";
import { getTemplateAccountId } from "./whatsapp-template-service";

/**
 * Envoi proactif vers un membre du personnel sur WhatsApp.
 *  - fenêtre de 24 h ouverte (le membre a écrit il y a moins de 24 h) : message libre, avec bouton
 *    lien éventuel (un seul bouton URL par message) ;
 *  - sinon : MODÈLE approuvé (POST /v1/inbox/conversations). Modèle absent/non approuvé : « skipped »,
 *    jamais d'envoi hors règles.
 */

export interface SendDeps {
  db: SupabaseClient;
  now: () => number;
  sendSession: (organizationId: string, accountId: string | undefined, message: OutboundMessage) => Promise<void>;
  client: Pick<ZernioClient, "startConversationWithTemplate">;
}
export const defaultSendDeps = (): SendDeps => ({
  db: getSupabaseServiceClient(), now: () => Date.now(), client: new ZernioClient(),
  sendSession: async (org, accountId, message) => { await (await getMessagingProviderForChannel(org, "whatsapp", accountId)).sendMessage(org, message); },
});

export interface SendToMemberInput {
  organizationId: string;
  e164: string;
  /** Texte libre (fenêtre ouverte). */
  text: string;
  button?: { text: string; url: string };
  template?: { key: TemplateKey; values: string[] };
}
export type SendToMemberResult = { status: "sent"; via: "session" | "template" } | { status: "skipped" | "failed"; reason: string };

export async function sendWhatsAppToMember(input: SendToMemberInput, deps: SendDeps = defaultSendDeps()): Promise<SendToMemberResult> {
  const { data, error } = await deps.db.from("channel_identities").select("last_inbound_at, whatsapp_conversation_id, whatsapp_account_id").eq("organization_id", input.organizationId).eq("channel", "whatsapp").eq("external_id", input.e164).eq("status", "active").maybeSingle();
  if (error) return { status: "failed", reason: error.message.slice(0, 200) };
  const identity = data as { last_inbound_at: string | null; whatsapp_conversation_id: string | null; whatsapp_account_id: string | null } | null;
  if (!identity) return { status: "skipped", reason: "numéro non lié" };

  if (identity.whatsapp_conversation_id && isSessionWindowOpen(identity.last_inbound_at, deps.now())) {
    try {
      await deps.sendSession(input.organizationId, identity.whatsapp_account_id ?? undefined, {
        to: input.e164, channel: "whatsapp", content: input.text, externalThreadId: identity.whatsapp_conversation_id,
        ...(input.button ? { buttons: [input.button] } : {}),
      });
      return { status: "sent", via: "session" };
    } catch (e) { console.warn("[whatsapp-send] envoi en fenêtre échoué, repli sur le modèle:", e instanceof Error ? e.message : e); }
  }

  if (!input.template) return { status: "skipped", reason: "fenêtre de 24 h fermée et aucun modèle prévu" };
  const def = templateByKey(input.template.key);
  if (!def) return { status: "skipped", reason: "modèle inconnu" };
  const { data: row } = await deps.db.from("whatsapp_templates").select("status").eq("organization_id", input.organizationId).eq("template_key", def.key).maybeSingle();
  if ((row as { status?: string } | null)?.status !== "APPROVED") return { status: "skipped", reason: "modèle non approuvé par Meta" };
  const participantId = toParticipantId(input.e164);
  const accountId = identity.whatsapp_account_id ?? (await getTemplateAccountId(deps.db, input.organizationId));
  if (!participantId || !accountId) return { status: "skipped", reason: "numéro ou compte WhatsApp introuvable" };
  try {
    await deps.client.startConversationWithTemplate({ accountId, participantId, templateName: def.name, templateLanguage: def.language, templateParams: buildTemplateParams(def, input.template.values) });
    return { status: "sent", via: "template" };
  } catch (e) { return { status: "failed", reason: (e instanceof Error ? e.message : "erreur").slice(0, 200) }; }
}

/** Port WhatsApp de `notify()` : alerte en message libre dans la fenêtre, sinon modèle « alerte ». */
export function createWhatsAppAlertPort(deps?: SendDeps, appUrl?: string): AlertWhatsAppPort {
  return {
    async send({ organizationId, e164, title, body, alertId }) {
      const res = await sendWhatsAppToMember({
        organizationId, e164, text: `🚨 ${title}${body ? `\n${body}` : ""}\n\nRépondez VU pour confirmer que vous l'avez vue.`,
        ...(appUrl ? { button: { text: "Ouvrir les alertes", url: `${appUrl}/dashboard/alerts#${alertId}` } } : {}),
        template: { key: "alert", values: [title, body] },
      }, deps);
      if (res.status !== "sent") console.info(`[whatsapp-send] alerte ${alertId} non envoyée (${res.status}) : ${res.reason}`);
      return res.status;
    },
  };
}
