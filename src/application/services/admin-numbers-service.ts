import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
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
 * Ajoute un numéro au pool (non assigné — `organization_id` reste null
 * tant qu'un Super Admin ne l'assigne pas explicitement via
 * `assignPhoneNumberToOrganization` ci-dessous, section 62).
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

/**
 * Lot 4 (sections 55 et 62 du master prompt) — l'assignation d'un numéro
 * à une organisation était explicitement hors périmètre du Lot C
 * (documenté à l'origine dans le commentaire de `addPhoneNumber`
 * ci-dessus, désormais mis à jour). Sans elle, le bonus "numéro dédié"
 * (+1/+3/+5 groupes WhatsApp, section 55) n'était jamais atteignable —
 * voir entitlements-service.ts::canUseFeature(), qui lit
 * `phone_numbers.status = 'assigned'` via `hasDedicatedPhoneNumber()`
 * (phone-number-repository.ts).
 *
 * Refuse d'écraser silencieusement l'assignation d'une AUTRE
 * organisation (un numéro reste la propriété exclusive d'un seul tenant
 * à la fois) — l'opérateur doit d'abord le retirer explicitement via
 * `unassignPhoneNumber()`.
 */
export async function assignPhoneNumberToOrganization(
  numberId: string,
  organizationId: string,
  actorUserId: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: existing, error: fetchError } = await supabase
    .from("phone_numbers")
    .select("id, phone_e164, organization_id, status")
    .eq("id", numberId)
    .maybeSingle();

  if (fetchError) throw new Error(`Erreur lecture phone_numbers: ${fetchError.message}`);
  if (!existing) throw new NotFoundError("Numéro introuvable");
  if (existing.organization_id && existing.organization_id !== organizationId) {
    throw new ValidationError("Ce numéro est déjà assigné à une autre entreprise — retirez-le d'abord.");
  }
  if (existing.status === "suspended") {
    throw new ValidationError("Ce numéro est suspendu — réactivez-le avant de l'assigner.");
  }

  const { error: updateError } = await supabase
    .from("phone_numbers")
    .update({ organization_id: organizationId, status: "assigned" })
    .eq("id", numberId);

  if (updateError) throw new Error(`Erreur assignation du numéro: ${updateError.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId,
    entityId: numberId,
    action: "PHONE_NUMBER_ASSIGNED",
    entityType: "phone_number",
    beforeState: { phone_e164: existing.phone_e164, organization_id: existing.organization_id },
    afterState: { phone_e164: existing.phone_e164, organization_id: organizationId },
  });
}

/**
 * Retire un numéro d'une organisation — repasse `status='available'` et
 * remet `organization_id` à null (retour au pool, réassignable). L'audit
 * log conserve l'organisation qui possédait le numéro (before_state),
 * jamais `null` : sans ça la trace d'audit perdrait l'information la
 * plus utile d'un retrait.
 */
export async function unassignPhoneNumber(numberId: string, actorUserId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: existing, error: fetchError } = await supabase
    .from("phone_numbers")
    .select("id, phone_e164, organization_id")
    .eq("id", numberId)
    .maybeSingle();

  if (fetchError) throw new Error(`Erreur lecture phone_numbers: ${fetchError.message}`);
  if (!existing) throw new NotFoundError("Numéro introuvable");
  if (!existing.organization_id) {
    throw new ValidationError("Ce numéro n'est assigné à aucune entreprise.");
  }

  const { error: updateError } = await supabase
    .from("phone_numbers")
    .update({ organization_id: null, status: "available" })
    .eq("id", numberId);

  if (updateError) throw new Error(`Erreur retrait du numéro: ${updateError.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId: existing.organization_id,
    entityId: numberId,
    action: "PHONE_NUMBER_UNASSIGNED",
    entityType: "phone_number",
    beforeState: { phone_e164: existing.phone_e164, organization_id: existing.organization_id },
    afterState: { phone_e164: existing.phone_e164, organization_id: null },
  });
}
