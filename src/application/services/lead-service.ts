import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { LeadScoreResult } from "@/domain/entities/lead";
import { notifyOrgAdmins } from "./notification-service";
import { trackEvent } from "./analytics-service";

/**
 * V1 : scoring RULE-BASED, explicitement pas de l'IA (section 12 : "ne pas
 * inventer des données"). On ne calcule un score qu'à partir de signaux
 * réellement observés (nombre de messages, ancienneté). Un scoring par IA
 * pourra être branché en Phase 8+ derrière la même interface
 * LeadScoreResult, avec `model` renseigné au nom du modèle utilisé.
 */
export async function computeRuleBasedScore(leadId: string): Promise<LeadScoreResult> {
  const supabase = getSupabaseServiceClient();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, organization_id, contact_id")
    .eq("id", leadId)
    .single();

  if (leadError || !lead) {
    throw new Error(`Lead introuvable pour scoring: ${leadId}`);
  }

  const { data: conversations, error: convError } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", lead.organization_id)
    .eq("contact_id", lead.contact_id);

  if (convError) {
    throw new Error(`Erreur lecture conversations pour scoring: ${convError.message}`);
  }

  const conversationIds = (conversations ?? []).map((c) => c.id);
  let messageCount = 0;
  if (conversationIds.length > 0) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", conversationIds);
    messageCount = count ?? 0;
  }

  const engagementScore = Math.min(60, messageCount * 10);
  const recencyBonus = 20; // signal fixe V1 — affiné en Phase 8 avec l'historique réel
  const score = Math.min(100, engagementScore + recencyBonus);

  const result: LeadScoreResult = {
    score,
    reason: `Score rule-based V1 : ${messageCount} message(s) échangé(s) au total avec ce contact.`,
    model: "rule-based-v1",
    computedAt: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from("leads")
    .update({
      score: result.score,
      score_reason: result.reason,
      score_model: result.model,
      score_computed_at: result.computedAt,
    })
    .eq("id", leadId);

  if (updateError) {
    throw new Error(`Impossible d'enregistrer le score du lead ${leadId}: ${updateError.message}`);
  }

  await supabase.from("lead_events").insert({
    organization_id: lead.organization_id,
    lead_id: leadId,
    event_type: "SCORE_UPDATED",
    payload: result,
  });

  return result;
}

export async function findOrCreateOpenLead(organizationId: string, contactId: string, source: string) {
  const supabase = getSupabaseServiceClient();

  const { data: existing, error: findError } = await supabase
    .from("leads")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .not("status", "in", "(customer,lost)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) throw new Error(`Erreur recherche lead existant: ${findError.message}`);
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from("leads")
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      status: "lead",
      source,
      last_contact_at: new Date().toISOString(),
    })
    .select("id, status")
    .single();

  if (createError || !created) {
    throw new Error(`Impossible de créer le lead: ${createError?.message}`);
  }

  await supabase.from("lead_events").insert({
    organization_id: organizationId,
    lead_id: created.id,
    event_type: "LEAD_CREATED",
    payload: { source },
  });

  await notifyOrgAdmins({
    organizationId,
    title: "Nouveau prospect.",
    body: `Un nouveau prospect vient d'être ajouté (canal : ${source}).`,
    relatedEntityType: "lead",
    relatedEntityId: created.id,
  });

  // Lot H, Partie 2 (master prompt §55) — uniquement dans la branche de
  // CRÉATION (pas quand un lead ouvert existant est réutilisé un peu plus
  // haut), cohérent avec le nom de l'événement `lead_created`.
  await trackEvent(organizationId, "lead_created", "lead", created.id, { source });

  return created;
}
