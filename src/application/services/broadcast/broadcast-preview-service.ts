import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { isFeatureEnabled } from "../entitlements-service";
import { effectiveRecipientCap, loadCandidates, pickRecipients, type BroadcastAudience } from "../contact-broadcast-service";
import { assertActorInOrganization, type PublicationActor } from "../publishing/publication-scheduling";
import {
  DEFAULT_NEW_NUMBER_DAILY_UNIQUE_CONTACTS,
  estimateBroadcastCost,
  planDelivery,
  suggestSendHour,
  type CostEstimate,
  type DeliveryPlan,
  type PlanningRecipient,
  type RateCard,
  type SendHourSuggestion,
} from "./broadcast-planning";

/**
 * C5 — aperçu d'une diffusion AVANT envoi : audience, coût estimé, modèles
 * requis, palier du numéro, horaire conseillé. Lecture seule : aucune écriture,
 * aucun envoi. Le résultat alimente la carte d'approbation (`pending_actions`, C1).
 */
export interface BroadcastPreviewInputs {
  recipients: PlanningRecipient[];
  hasTemplate: boolean;
  dailyUniqueLimit: number;
  alreadyStartedToday: number;
  serviceMessagesUsedThisMonth: number;
  inboundTimestamps: string[];
  rateCard?: RateCard;
  xafPerUsd?: number | null;
}

export interface BroadcastPreview {
  recipientCount: number;
  cost: CostEstimate;
  plan: Pick<DeliveryPlan, "counts" | "deferredByDay" | "notes">;
  suggestedHour: SendHourSuggestion;
}

/** Partie PURE (testée) : assemble l'aperçu à partir de données déjà chargées. */
export function buildBroadcastPreview(inputs: BroadcastPreviewInputs): BroadcastPreview {
  const cost = estimateBroadcastCost(inputs.recipients, {
    hasTemplate: inputs.hasTemplate,
    rateCard: inputs.rateCard,
    xafPerUsd: inputs.xafPerUsd,
    serviceMessagesUsedThisMonth: inputs.serviceMessagesUsedThisMonth,
  });
  const plan = planDelivery(inputs.recipients, {
    hasTemplate: inputs.hasTemplate,
    dailyUniqueLimit: inputs.dailyUniqueLimit,
    alreadyStartedToday: inputs.alreadyStartedToday,
  });
  return {
    recipientCount: inputs.recipients.length,
    cost,
    plan: { counts: plan.counts, deferredByDay: plan.deferredByDay, notes: plan.notes },
    suggestedHour: suggestSendHour(inputs.inboundTimestamps),
  };
}

const CHUNK = 200;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function startOfDoualaDayIso(now: Date): string {
  const shifted = new Date(now.getTime() + 60 * 60 * 1000); // UTC+1
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 60 * 60 * 1000).toISOString();
}

/**
 * Partie base de données. Chaque lecture est filtrée par `organization_id` (service-role) et
 * l'acteur est vérifié membre de l'organisation. NON couverte par des tests unitaires
 * (pas de base réelle ici) : à valider en intégration.
 */
export async function previewBroadcast(
  actor: PublicationActor,
  input: { audience: BroadcastAudience; templateName?: string | null; rateCard?: RateCard; xafPerUsd?: number | null },
  now = new Date(),
): Promise<BroadcastPreview> {
  await assertActorInOrganization(actor);
  const supabase = getSupabaseServiceClient();
  const orgId = actor.organizationId;

  const { limit } = await isFeatureEnabled(orgId, "broadcast_contacts");
  const picked = pickRecipients(await loadCandidates(orgId, input.audience), effectiveRecipientCap(limit));

  // Fenêtre de 24 h : dernier message ENTRANT (pas `last_message_at`, qui compte aussi nos envois).
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const inWindowConversations = new Set<string>();
  const ids = picked.map((p) => p.conversationId);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("messages")
      .select("conversation_id")
      .eq("organization_id", orgId)
      .eq("direction", "inbound")
      .gte("created_at", since)
      .in("conversation_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`Lecture de la fenêtre de messagerie impossible: ${error.message}`);
    for (const row of data ?? []) inWindowConversations.add(row.conversation_id as string);
  }
  const recipients: PlanningRecipient[] = picked.map((p) => ({
    contactId: p.contactId,
    channel: p.channel,
    // Telegram n'a pas de fenêtre : toujours « dans la fenêtre » (message libre).
    withinWindow: p.channel === "telegram" ? true : inWindowConversations.has(p.conversationId),
  }));

  const { data: settings } = await supabase.from("growth_settings").select("whatsapp_daily_unique_contacts").eq("organization_id", orgId).maybeSingle();
  const dailyUniqueLimit = (settings?.whatsapp_daily_unique_contacts as number | undefined) ?? DEFAULT_NEW_NUMBER_DAILY_UNIQUE_CONTACTS;

  // Approximations prudentes, à affiner (voir docs) : envois WhatsApp réussis aujourd'hui / ce mois-ci.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data: sentMonth } = await supabase
    .from("contact_broadcast_recipients")
    .select("contact_id, sent_at")
    .eq("organization_id", orgId)
    .eq("channel", "whatsapp")
    .eq("status", "sent")
    .gte("sent_at", monthStart)
    .limit(10000);
  const dayStart = startOfDoualaDayIso(now);
  const startedToday = new Set((sentMonth ?? []).filter((r) => (r.sent_at as string) >= dayStart).map((r) => r.contact_id as string));

  const { data: inbound } = await supabase
    .from("messages")
    .select("created_at")
    .eq("organization_id", orgId)
    .eq("direction", "inbound")
    .gte("created_at", new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(5000);

  return buildBroadcastPreview({
    recipients,
    hasTemplate: Boolean(input.templateName?.trim()),
    dailyUniqueLimit,
    alreadyStartedToday: startedToday.size,
    serviceMessagesUsedThisMonth: (sentMonth ?? []).length,
    inboundTimestamps: (inbound ?? []).map((r) => r.created_at as string),
    rateCard: input.rateCard,
    xafPerUsd: input.xafPerUsd,
  });
}
