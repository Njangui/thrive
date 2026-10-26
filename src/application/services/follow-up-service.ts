import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { hasFeature } from "./entitlements-service";
import { getMessagingProviderForChannel } from "@/infrastructure/providers/registry";
import { buildTenantAIContext } from "./tenant-ai-context";
import { runAITask } from "./ai-metering";
import { checkReplyQuality } from "./reply-quality";
import { notifyOrgAdmins } from "./notification-service";

const HIGH_ENGAGEMENT_SCORE = 70;
const HIGH_DELAY_MS = 24 * 60 * 60 * 1000;
const STANDARD_DELAY_MS = 48 * 60 * 60 * 1000;

export interface FollowUpRunResult {
  scheduled: number;
  sent: number;
  skipped: number;
  failed: number;
}

function buildDeterministicFollowUp(firstName: string | null, score: number | null, tier: "engaged_24h" | "standard_48h") {
  const hello = firstName?.trim() ? `Bonjour ${firstName.trim()}` : "Bonjour";
  if (tier === "engaged_24h") {
    return `${hello}, je reviens vers vous concernant votre demande. Nous pouvons vous aider à finaliser votre choix si vous avez encore une question.`;
  }
  return `${hello}, nous restons disponibles si vous souhaitez reprendre votre demande. Dites-nous simplement ce dont vous avez besoin et nous vous répondrons rapidement.`;
}

/** Plafond de sortie IA d'une relance (audit R4) : un message court, jamais un texte long. */
export const FOLLOW_UP_MAX_TOKENS = 160;
/** Une tâche `processing` plus ancienne que ça est considérée abandonnée (crash) et reprise. */
const STALE_PROCESSING_MS = 15 * 60 * 1000;

/**
 * Personnalisation IA d'une relance (Q23 B) : mêmes garde-fous que les réponses clients.
 * Le modèle ne voit QUE notre message fixe (aucun texte client : pas d'injection possible) ;
 * sa sortie est écartée par le contrôle qualité si elle cite un prix, un lien, un contact,
 * un stock, fuit les consignes ou salue de nouveau. Dans tous ces cas, le message fixe part.
 */
export async function personalizeFollowUp(organizationId: string, base: string): Promise<string> {
  try {
    const systemPrompt = await buildTenantAIContext(organizationId, []);
    const userMessage =
      "Reformule cette relance en une ou deux phrases chaleureuses, sans salutation, sans prix, sans lien, " +
      `sans promesse ni remise, sans coordonnées : ${base}`;
    const res = await runAITask({
      organizationId,
      task: "follow_up",
      inputChars: systemPrompt.length + userMessage.length,
      call: (provider) => provider.generateText({ systemPrompt, userMessage, maxTokens: FOLLOW_UP_MAX_TOKENS }),
    });
    const text = res?.text?.trim();
    if (!text) return base;
    const verdict = checkReplyQuality(
      text,
      { allowedAmounts: [], allowedOrigins: [], allowedPhones: [], allowedEmails: [], alreadyGreeted: true, protectedMarkers: [] },
      { maxLength: 400, maxLines: 4 },
    );
    return verdict.ok ? text : base;
  } catch {
    return base; // IA optionnelle (indisponible, crédits épuisés...) : le message fixe reste la valeur envoyée.
  }
}

async function hasRecentInboundSince(supabase: ReturnType<typeof getSupabaseServiceClient>, conversationId: string, since: string) {
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .gt("created_at", since);
  return (count ?? 0) > 0;
}

/**
 * Crée les relances à échéance sans envoyer de message. Cette étape est
 * volontairement déterministe : score observé -> délai fixe. L'IA n'est
 * jamais appelée pour décider QUI relancer.
 */
/** Lot O : relances automatiques = fonctionnalité du CRM complet (Starter+). Mémoïsé par exécution. */
async function orgHasFollowUps(cache: Map<string, boolean>, organizationId: string): Promise<boolean> {
  const cached = cache.get(organizationId);
  if (cached !== undefined) return cached;
  const enabled = await hasFeature(organizationId, "follow_ups").catch(() => false);
  cache.set(organizationId, enabled);
  return enabled;
}

export async function scheduleDueFollowUps(now = new Date()): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const followUpsByOrg = new Map<string, boolean>();
  const cutoff = new Date(now.getTime() - HIGH_DELAY_MS).toISOString();

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, organization_id, contact_id, score, last_contact_at, status, contacts(full_name)")
    .in("status", ["visitor", "lead", "qualified", "opportunity"])
    .not("last_contact_at", "is", null)
    .lte("last_contact_at", cutoff)
    .limit(500);
  if (error) throw new Error(`Erreur lecture leads à relancer: ${error.message}`);

  let scheduled = 0;
  for (const lead of leads ?? []) {
    if (!(await orgHasFollowUps(followUpsByOrg, lead.organization_id))) continue;
    const lastContact = lead.last_contact_at ? new Date(lead.last_contact_at).getTime() : 0;
    const tier = (lead.score ?? 0) >= HIGH_ENGAGEMENT_SCORE ? "engaged_24h" : "standard_48h";
    const dueAt = new Date(lastContact + (tier === "engaged_24h" ? HIGH_DELAY_MS : STANDARD_DELAY_MS));
    if (dueAt > now) continue;

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, channel, external_thread_id, last_message_at")
      .eq("organization_id", lead.organization_id)
      .eq("contact_id", lead.contact_id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (!conversation) continue;

    // Une réponse du client annule naturellement la relance planifiée.
    if (conversation.last_message_at && new Date(conversation.last_message_at).getTime() > lastContact) {
      const recentInbound = await hasRecentInboundSince(supabase, conversation.id, lead.last_contact_at as string);
      if (recentInbound) continue;
    }

    const { data: existingPending } = await supabase
      .from("automated_followups")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();
    if (existingPending) continue;

    const { error: insertError } = await supabase.from("automated_followups").upsert(
      {
        organization_id: lead.organization_id,
        lead_id: lead.id,
        tier,
        due_at: dueAt.toISOString(),
        status: "pending",
        channel: conversation.channel,
      },
      { onConflict: "lead_id,tier", ignoreDuplicates: true },
    );
    if (!insertError) scheduled++;
  }
  return scheduled;
}

/**
 * Envoie les relances arrivées à échéance. Pipeline : message déterministe
 * -> contexte client/catalogue déjà disponible -> IA uniquement en dernier
 * recours si elle est activée et si la génération réussit. Une erreur IA
 * n'empêche jamais l'envoi du message déterministe.
 */
export async function processDueFollowUps(now = new Date()): Promise<FollowUpRunResult> {
  const supabase = getSupabaseServiceClient();
  await scheduleDueFollowUps(now);

  const { data: tasks, error } = await supabase
    .from("automated_followups")
    .select("id, organization_id, lead_id, tier, channel, leads(contact_id, score, last_contact_at, contacts(full_name, phone_e164))")
    .eq("status", "pending")
    .lte("due_at", now.toISOString())
    .order("due_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Erreur lecture relances: ${error.message}`);

  const result: FollowUpRunResult = { scheduled: 0, sent: 0, skipped: 0, failed: 0 };
  const followUpsByOrg = new Map<string, boolean>();

  // Reprise des tâches abandonnées en `processing` (crash entre la réservation et l'envoi).
  await supabase
    .from("automated_followups")
    .update({ status: "pending" })
    .eq("status", "processing")
    .lt("claimed_at", new Date(now.getTime() - STALE_PROCESSING_MS).toISOString());

  for (const task of tasks ?? []) {
    // Réservation atomique (audit R2) : un seul exécutant obtient la ligne.
    const { data: claimed } = await supabase
      .from("automated_followups")
      .update({ status: "processing", claimed_at: now.toISOString() })
      .eq("id", task.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    if (!(await orgHasFollowUps(followUpsByOrg, task.organization_id))) {
      await supabase.from("automated_followups").update({ status: "skipped", error_message: "Relances automatiques non incluses dans l'offre" }).eq("id", task.id);
      result.skipped++;
      continue;
    }
    const lead = task.leads as unknown as {
      contact_id: string;
      score: number | null;
      last_contact_at: string | null;
      contacts?: { full_name?: string | null; phone_e164?: string | null };
    } | null;
    if (!lead) {
      await supabase.from("automated_followups").update({ status: "skipped", error_message: "Lead introuvable" }).eq("id", task.id);
      result.skipped++;
      continue;
    }

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, external_thread_id, channel, last_message_at, provider_account_id")
      .eq("organization_id", task.organization_id)
      .eq("contact_id", lead.contact_id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (!conversation || !conversation.external_thread_id) {
      await supabase.from("automated_followups").update({ status: "skipped", error_message: "Aucune conversation exploitable" }).eq("id", task.id);
      result.skipped++;
      continue;
    }

    if (lead.last_contact_at && await hasRecentInboundSince(supabase, conversation.id, lead.last_contact_at)) {
      await supabase.from("automated_followups").update({ status: "skipped", error_message: "Le client a répondu depuis la planification" }).eq("id", task.id);
      result.skipped++;
      continue;
    }

    const firstName = lead.contacts?.full_name?.split(/\s+/)[0] ?? null;
    let content = buildDeterministicFollowUp(firstName, lead.score, task.tier as "engaged_24h" | "standard_48h");

    // IA en dernière position, sous contrôle qualité (Q23 B) : elle enrichit le message sans jamais
    // décider du délai ni de la population relancée ; au moindre doute, le message fixe part.
    const { data: aiConfig } = await supabase.from("ai_config").select("enabled").eq("organization_id", task.organization_id).maybeSingle();
    if (aiConfig?.enabled) content = await personalizeFollowUp(task.organization_id, content);

    try {
      const messaging = await getMessagingProviderForChannel(task.organization_id, conversation.channel, (conversation as { provider_account_id?: string | null }).provider_account_id);
      const sent = await messaging.sendMessage(task.organization_id, {
        to: lead.contacts?.phone_e164 ?? conversation.external_thread_id,
        channel: conversation.channel as "whatsapp" | "telegram",
        content,
        externalThreadId: conversation.external_thread_id,
      });

      await supabase.from("automated_followups").update({
        status: "sent",
        message_content: content,
        provider_message_id: sent.providerMessageId,
        sent_at: now.toISOString(),
      }).eq("id", task.id).eq("status", "processing");

      await supabase.from("messages").insert({
        organization_id: task.organization_id,
        conversation_id: conversation.id,
        direction: "outbound",
        sender: "ai",
        content,
      });
      await supabase.from("conversations").update({ last_message_at: now.toISOString() }).eq("id", conversation.id);
      await notifyOrgAdmins({
        organizationId: task.organization_id,
        title: "Relance client envoyée",
        body: `Une relance ${task.tier === "engaged_24h" ? "24 h" : "48 h"} a été envoyée automatiquement.`,
        relatedEntityType: "conversation",
        relatedEntityId: conversation.id,
        priority: "normal",
      });
      result.sent++;
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      await supabase.from("automated_followups").update({ status: "failed", error_message: message }).eq("id", task.id);
      result.failed++;
    }
  }

  return result;
}
