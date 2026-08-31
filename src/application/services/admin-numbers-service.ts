import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError } from "@/lib/errors";
import { writeAdminAuditLog } from "./admin-organizations-service";

export interface AdminPhoneNumberListItem {
  id: string;
  phoneE164: string;
  country: string | null;
  status: string;
  organizationId: string | null;
  organizationName: string | null;
  createdAt: string;
}

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * Section 45 (route `/admin/numbers`) : lecture de `phone_numbers`
 * (migration 0016 — stub minimal, voir cette migration pour le contexte).
 */
export async function listPhoneNumbersForAdmin(): Promise<AdminPhoneNumberListItem[]> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("phone_numbers")
    .select("id, phone_e164, country, status, organization_id, created_at, organizations(name)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Erreur lecture phone_numbers: ${error.message}`);

  return (data ?? []).map((n) => ({
    id: n.id,
    phoneE164: n.phone_e164,
    country: n.country,
    status: n.status,
    organizationId: n.organization_id,
    organizationName: (n as unknown as { organizations?: { name?: string } }).organizations?.name ?? null,
    createdAt: n.created_at,
  }));
}

/**
 * Ajoute un numéro au pool (non assigné — `organization_id` reste null,
 * l'assignation à une entreprise n'est pas dans le périmètre de ce lot).
 * Écrit un audit log platform-level (`organization_id: null` — colonne
 * nullable sur `audit_logs`, migration 0006).
 */
export async function addPhoneNumber(
  phoneE164: string,
  country: string | undefined,
  actorUserId: string,
): Promise<void> {
  const trimmed = phoneE164.trim();
  if (!E164_PATTERN.test(trimmed)) {
    throw new ValidationError("Numéro invalide — format E.164 attendu (ex: +237690000000)");
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("phone_numbers")
    .insert({ phone_e164: trimmed, country: country?.trim() || null })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") throw new ValidationError("Ce numéro existe déjà");
    throw new Error(`Erreur création numéro: ${error.message}`);
  }

  // OPTIMISATION : réutilise `writeAdminAuditLog` (admin-organizations-
  // service.ts) au lieu de dupliquer l'insert `audit_logs` — voir le
  // commentaire sur cette fonction pour le contexte.
  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    entityId: data.id,
    action: "PHONE_NUMBER_ADDED",
    entityType: "phone_number",
    afterState: { phone_e164: trimmed, country: country ?? null },
  });
}
