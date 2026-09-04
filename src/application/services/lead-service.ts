import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { LeadScoreResult } from "@/domain/entities/lead";
import { notifyOrgAdmins } from "./notification-service";
import { trackEvent } from "./analytics-service";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Statuts réels du pipeline — `lead_status` (0003_crm.sql). Le cahier
 * Lot L citait 'new/contacted/interested/customer/lost', qui ne
 * correspond à AUCUNE valeur du schéma réel ; utilisé ici l'enum tel
 * qu'il existe effectivement en base (vérifié contre la migration, pas
 * deviné) — voir RAPPORT_LOT_L.md.
 */
export const LEAD_STATUSES = ["visitor", "lead", "qualified", "opportunity", "customer", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];


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

// ---------------------------------------------------------------------------
// Lot L, Partie 3 — écran /dashboard/leads (lecture paginée + changement de statut)
// ---------------------------------------------------------------------------

export interface LeadListItem {
  id: string;
  status: LeadStatus;
  source: string | null;
  intent: string | null;
  score: number | null;
  scoreReason: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  contactName: string | null;
  contactPhone: string | null;
}

export interface ListLeadsOptions {
  status?: LeadStatus;
  page: number;
  pageSize: number;
}

export interface ListLeadsResult {
  leads: LeadListItem[];
  totalCount: number;
}

interface LeadRow {
  id: string;
  status: string;
  source: string | null;
  intent: string | null;
  score: number | null;
  score_reason: string | null;
  last_contact_at: string | null;
  next_follow_up_at: string | null;
  created_at: string;
  contacts?: { full_name?: string | null; phone_e164?: string | null } | null;
}

/**
 * Pagination `.range()` — même convention que products/page.tsx
 * (OPTIMISATION précédente) : jamais charger un pipeline complet sans
 * limite, même si un lead-service.ts existant n'en avait pas encore
 * besoin jusqu'ici (peu de leads en usage réel V1, mais le cahier
 * l'exige explicitement pour ce nouvel écran).
 */
export async function listLeadsForOrg(organizationId: string, options: ListLeadsOptions): Promise<ListLeadsResult> {
  const supabase = getSupabaseServiceClient();
  const from = (options.page - 1) * options.pageSize;
  const to = from + options.pageSize - 1;

  let query = supabase
    .from("leads")
    .select(
      "id, status, source, intent, score, score_reason, last_contact_at, next_follow_up_at, created_at, contacts(full_name, phone_e164)",
      { count: "exact" },
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (options.status) {
    query = query.eq("status", options.status);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`Erreur lecture des prospects: ${error.message}`);

  const rows = (data ?? []) as unknown as LeadRow[];
  return {
    leads: rows.map((row) => ({
      id: row.id,
      status: row.status as LeadStatus,
      source: row.source,
      intent: row.intent,
      score: row.score,
      scoreReason: row.score_reason,
      lastContactAt: row.last_contact_at,
      nextFollowUpAt: row.next_follow_up_at,
      createdAt: row.created_at,
      contactName: row.contacts?.full_name ?? null,
      contactPhone: row.contacts?.phone_e164 ?? null,
    })),
    totalCount: count ?? 0,
  };
}

/** Action rapide de l'écran (cahier, section UI) — journalise dans `lead_events`, cohérent avec le reste du pipeline (STATUS_CHANGED déjà un type d'événement attendu, voir 0003_crm.sql). */
export async function updateLeadStatus(
  organizationId: string,
  leadId: string,
  newStatus: LeadStatus,
  actorUserId?: string,
): Promise<void> {
  if (!LEAD_STATUSES.includes(newStatus)) {
    throw new ValidationError(`Statut "${newStatus}" inconnu.`);
  }

  const supabase = getSupabaseServiceClient();
  const { data: lead, error: readError } = await supabase
    .from("leads")
    .select("id, status")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (readError) throw new Error(`Erreur lecture du prospect: ${readError.message}`);
  if (!lead) throw new NotFoundError("Prospect introuvable.");
  if (lead.status === newStatus) return; // idempotent — pas d'événement bruité pour rien

  const { error: updateError } = await supabase.from("leads").update({ status: newStatus }).eq("id", leadId);
  if (updateError) throw new Error(`Impossible de changer le statut du prospect: ${updateError.message}`);

  await supabase.from("lead_events").insert({
    organization_id: organizationId,
    lead_id: leadId,
    event_type: "STATUS_CHANGED",
    payload: { from: lead.status, to: newStatus, actorUserId: actorUserId ?? null },
  });
}
