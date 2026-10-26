import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requireMembership } from "./auth-service";
import { buildDeliveryRules, EMPTY_DELIVERY_RULES, EMPTY_DELIVERY_SETTINGS, MAX_PICKUP_NOTE_LENGTH, parseZoneInput, type DeliveryRules, type DeliverySettings, type DeliveryZone } from "./delivery-rules";

/**
 * C3 — accès base des règles de livraison (migration 0145).
 *
 * Isolation (principe 5) : client service-role, donc CHAQUE requête filtre sur
 * `organization_id`. `loadDeliveryRules` est appelée par l'assistant sans utilisateur et
 * NE LÈVE JAMAIS : sans règles lisibles, on retombe sur « je vérifie » (comportement
 * d'avant). Les écritures exigent propriétaire ou administrateur du tenant.
 */

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function zoneFromRow(row: Row): DeliveryZone {
  return {
    name: String(row.name),
    slug: String(row.slug),
    aliases: Array.isArray(row.aliases) ? row.aliases.filter((a): a is string => typeof a === "string") : [],
    feeAmount: num(row.fee_amount),
    isFree: row.is_free === true,
    freeAboveAmount: num(row.free_above_amount),
    etaText: (row.eta_text as string | null) ?? null,
  };
}

function settingsFromRow(row: Row | null | undefined): DeliverySettings {
  if (!row) return EMPTY_DELIVERY_SETTINGS;
  return {
    pickupAvailable: typeof row.pickup_available === "boolean" ? row.pickup_available : null,
    pickupNote: (row.pickup_note as string | null) ?? null,
    acceptsCashOnDelivery: typeof row.accepts_cash_on_delivery === "boolean" ? row.accepts_cash_on_delivery : null,
  };
}

/** Zones ACTIVES et réglages du commerçant. Ne lève jamais : `EMPTY_DELIVERY_RULES` si la lecture échoue. */
export async function loadDeliveryRules(organizationId: string): Promise<DeliveryRules> {
  try {
    const supabase = getSupabaseServiceClient();
    const [zones, settings] = await Promise.all([
      supabase.from("delivery_zones").select("*").eq("organization_id", organizationId).eq("is_active", true).order("name", { ascending: true }),
      supabase.from("delivery_settings").select("*").eq("organization_id", organizationId).maybeSingle(),
    ]);
    if (zones.error) throw new Error(zones.error.message);
    if (settings.error) throw new Error(settings.error.message);
    return buildDeliveryRules((zones.data ?? []).map((r) => zoneFromRow(r as Row)), settingsFromRow(settings.data as Row | null));
  } catch (error) {
    console.warn(`[delivery] règles illisibles (org ${organizationId}):`, error instanceof Error ? error.message : error);
    return EMPTY_DELIVERY_RULES;
  }
}

/** Lecture pour l'écran du commerçant (zones inactives comprises). */
export async function listDeliveryZones(organizationId: string): Promise<Array<DeliveryZone & { isActive: boolean }>> {
  await requireMembership(organizationId);
  const { data, error } = await getSupabaseServiceClient().from("delivery_zones").select("*").eq("organization_id", organizationId).order("name", { ascending: true });
  if (error) throw new Error(`Erreur lecture zones de livraison: ${error.message}`);
  return (data ?? []).map((r) => ({ ...zoneFromRow(r as Row), isActive: (r as Row).is_active !== false }));
}

/** Crée ou met à jour une zone (identifiée par son nom normalisé). Refuse une saisie invalide au lieu de la corriger. */
export async function saveDeliveryZone(organizationId: string, input: unknown): Promise<DeliveryZone> {
  await requireMembership(organizationId, ["owner", "admin"]);
  const parsed = parseZoneInput(input);
  if (!parsed.ok) throw new ValidationError(`Zone de livraison invalide : ${parsed.errors.join(" ; ")}`);
  const { zone } = parsed;
  const { error } = await getSupabaseServiceClient()
    .from("delivery_zones")
    .upsert(
      {
        organization_id: organizationId,
        name: zone.name,
        slug: zone.slug,
        aliases: zone.aliases,
        fee_amount: zone.feeAmount,
        is_free: zone.isFree,
        free_above_amount: zone.freeAboveAmount,
        eta_text: zone.etaText,
        is_active: zone.isActive,
      },
      { onConflict: "organization_id,slug" },
    );
  if (error) throw new Error(`Erreur enregistrement zone de livraison: ${error.message}`);
  const { isActive: _ignored, ...saved } = zone;
  void _ignored;
  return saved;
}

export async function removeDeliveryZone(organizationId: string, slug: string): Promise<void> {
  await requireMembership(organizationId, ["owner", "admin"]);
  const { error, count } = await getSupabaseServiceClient().from("delivery_zones").delete({ count: "exact" }).eq("organization_id", organizationId).eq("slug", slug);
  if (error) throw new Error(`Erreur suppression zone de livraison: ${error.message}`);
  if (!count) throw new NotFoundError("Zone de livraison introuvable.");
}

/** Retrait et paiement à la livraison : `null` = « non renseigné » (on ne répond ni oui ni non). */
export async function saveDeliverySettings(organizationId: string, patch: Partial<DeliverySettings>): Promise<DeliverySettings> {
  await requireMembership(organizationId, ["owner", "admin"]);
  const row: Record<string, unknown> = { organization_id: organizationId };
  if ("pickupAvailable" in patch) {
    if (patch.pickupAvailable !== null && typeof patch.pickupAvailable !== "boolean") throw new ValidationError("Retrait : vrai, faux ou non renseigné attendu");
    row.pickup_available = patch.pickupAvailable;
  }
  if ("acceptsCashOnDelivery" in patch) {
    if (patch.acceptsCashOnDelivery !== null && typeof patch.acceptsCashOnDelivery !== "boolean") throw new ValidationError("Paiement à la livraison : vrai, faux ou non renseigné attendu");
    row.accepts_cash_on_delivery = patch.acceptsCashOnDelivery;
  }
  if ("pickupNote" in patch) {
    const note = patch.pickupNote === null || patch.pickupNote === undefined ? null : String(patch.pickupNote).replace(/\s+/g, " ").trim() || null;
    if (note && note.length > MAX_PICKUP_NOTE_LENGTH) throw new ValidationError(`Note de retrait : ${MAX_PICKUP_NOTE_LENGTH} caractères maximum`);
    row.pickup_note = note;
  }
  const { error } = await getSupabaseServiceClient().from("delivery_settings").upsert(row, { onConflict: "organization_id" });
  if (error) throw new Error(`Erreur enregistrement réglages de livraison: ${error.message}`);
  return (await loadDeliveryRules(organizationId)).settings;
}
