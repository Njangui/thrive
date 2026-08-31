import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError, NotFoundError } from "@/lib/errors";

/**
 * appointment-service.ts — Lot E, Partie 2.
 * Table `appointments` déjà créée par 0007_inventory_appointments.sql
 * (statuts : scheduled/confirmed/completed/cancelled/no_show).
 * "Ne pas construire un calendrier complexe" (section 25) : une liste
 * triée par date suffit pour le MVP.
 */

export type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";

export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
];

export interface CreateAppointmentInput {
  organizationId: string;
  contactFullName: string;
  contactPhone?: string;
  serviceLabel: string;
  startAt: string; // ISO 8601
  endAt: string; // ISO 8601
  notes?: string;
}

export interface AppointmentListItem {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  serviceLabel: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  notes: string | null;
}

/**
 * Vérifie la cohérence d'une fenêtre de rendez-vous (fin après début, dates
 * valides). Fonction PURE — testée en isolation (appointment-service.test.ts),
 * conformément à la convention du projet (mock des seules fonctions
 * DB-dépendantes, garder les fonctions pures réelles).
 */
export function assertValidAppointmentWindow(startAt: string, endAt: string): void {
  const start = new Date(startAt);
  const end = new Date(endAt);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError("Date ou heure de rendez-vous invalide.");
  }
  if (end.getTime() <= start.getTime()) {
    throw new ValidationError("L'heure de fin doit être après l'heure de début.");
  }
}

/**
 * Crée un rendez-vous. Le client est identifié par téléphone quand fourni
 * (upsert sur `organization_id, phone_e164`, même logique que
 * conversation-service.ts::handleInboundMessage pour rester cohérent avec
 * le reste du CRM — un client pris par rendez-vous doit retrouver le même
 * contact s'il écrit ensuite sur WhatsApp). Sans téléphone (walk-in), un
 * contact minimal est créé.
 */
export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<{ appointmentId: string }> {
  if (!input.contactFullName.trim()) {
    throw new ValidationError("Le nom du client est requis.");
  }
  if (!input.serviceLabel.trim()) {
    throw new ValidationError("Le service est requis.");
  }
  assertValidAppointmentWindow(input.startAt, input.endAt);

  const supabase = getSupabaseServiceClient();

  const contactPayload = {
    organization_id: input.organizationId,
    full_name: input.contactFullName.trim(),
    source_channel: "appointments",
  };

  const { data: contact, error: contactError } = input.contactPhone
    ? await supabase
        .from("contacts")
        .upsert(
          { ...contactPayload, phone_e164: input.contactPhone },
          { onConflict: "organization_id,phone_e164" },
        )
        .select("id")
        .single()
    : await supabase.from("contacts").insert(contactPayload).select("id").single();

  if (contactError || !contact) {
    throw new Error(`Impossible d'enregistrer le client: ${contactError?.message}`);
  }

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      organization_id: input.organizationId,
      contact_id: contact.id,
      service_label: input.serviceLabel.trim(),
      start_at: input.startAt,
      end_at: input.endAt,
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Impossible de créer le rendez-vous: ${error?.message}`);
  }

  return { appointmentId: data.id };
}

/** Liste triée par date (les plus proches en premier) — pas de vue calendrier (section 25). */
export async function listAppointments(organizationId: string): Promise<AppointmentListItem[]> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("appointments")
    .select("id, service_label, start_at, end_at, status, notes, contacts(full_name, phone_e164)")
    .eq("organization_id", organizationId)
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(`Erreur lors de la lecture des rendez-vous: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const contact = row.contacts as unknown as { full_name: string | null; phone_e164: string | null } | null;
    return {
      id: row.id,
      contactName: contact?.full_name ?? null,
      contactPhone: contact?.phone_e164 ?? null,
      serviceLabel: row.service_label,
      startAt: row.start_at,
      endAt: row.end_at,
      status: row.status as AppointmentStatus,
      notes: row.notes,
    };
  });
}

export async function updateAppointmentStatus(
  appointmentId: string,
  organizationId: string,
  status: AppointmentStatus,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId)
    .eq("organization_id", organizationId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de mettre à jour le rendez-vous ${appointmentId}: ${error.message}`);
  }
  if (!data) {
    throw new NotFoundError("Rendez-vous introuvable");
  }
}
