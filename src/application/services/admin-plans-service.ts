import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { writeAdminAuditLog } from "./admin-organizations-service";
import { PLAN_KEYS, type PlanKey } from "./plans-repository";
import { USAGE_GAUGES, FEATURE_FLAGS } from "./subscription-service";

/**
 * Lot 4 — voir RAPPORT_LOT_4.md. Comble le trou documenté dans
 * 0012_plans_entitlements.sql : les 3 plans (`plans`) et leur grille de
 * limites (`plan_entitlements`) viennent bien de la DB (pas de valeurs
 * codées en dur dans le frontend, conforme section 54 du master
 * prompt), mais jusqu'ici RIEN ne les écrivait — seule une modification
 * SQL manuelle le permettait. Ce module est le SEUL point d'écriture
 * pour ces deux tables côté application (voir grep prouvant qu'aucun
 * autre fichier n'appelle `.from("plans")`/`.from("plan_entitlements")`
 * en update/insert avant ce lot).
 *
 * Ne gère PAS la création/suppression de plans : les 3 clés
 * (starter/business/pro) sont fixées par le modèle commercial
 * (section 55 du master prompt) et par `PLAN_KEYS` — seuls leurs
 * attributs (prix, nom, description, limites) sont éditables. Ajouter
 * un 4e plan est un changement de produit, pas un réglage
 * d'administration ; ça sort du périmètre de ce lot.
 */

export interface AdminPlanDetails {
  key: PlanKey;
  name: string;
  priceFcfa: number;
  description: string | null;
}

export interface AdminEntitlementMatrixEntry {
  key: string;
  label: string;
  /** -1 = illimité. Toujours une entrée par clé de PLAN_KEYS, même si la ligne DB est absente (voir buildMatrix). */
  limitsByPlan: Record<PlanKey, number>;
}

export interface AdminPlansOverview {
  plans: AdminPlanDetails[];
  /** Jauges d'usage (ai_credits, whatsapp_groups, ...) + fonctionnalités on/off (0 ou 1), même catalogue que le dashboard tenant (subscription-service.ts). */
  entitlements: AdminEntitlementMatrixEntry[];
  /** Bonus additifs conditionnels (ex: numéro dédié) — absence de ligne = 0, jamais -1/illimité (voir entitlements-service.ts). */
  dedicatedBonuses: AdminEntitlementMatrixEntry[];
}

const DEDICATED_BONUS_CATALOG: { key: string; label: string }[] = [
  { key: "whatsapp_groups_dedicated_bonus", label: "Bonus groupes WhatsApp (numéro dédié assigné, section 55)" },
];

function isPlanKey(value: string): value is PlanKey {
  return (PLAN_KEYS as readonly string[]).includes(value);
}

export async function getPlansOverviewForAdmin(): Promise<AdminPlansOverview> {
  const supabase = getSupabaseServiceClient();

  const [{ data: planRows, error: planError }, { data: entitlementRows, error: entitlementError }] = await Promise.all([
    supabase.from("plans").select("key, name, price_fcfa, description").order("price_fcfa", { ascending: true }),
    supabase.from("plan_entitlements").select("plan_key, entitlement_key, limit_value"),
  ]);

  if (planError) throw new Error(`Erreur lecture plans: ${planError.message}`);
  if (entitlementError) throw new Error(`Erreur lecture plan_entitlements: ${entitlementError.message}`);

  const plans: AdminPlanDetails[] = (planRows ?? [])
    .filter((row): row is typeof row & { key: PlanKey } => isPlanKey(row.key))
    .map((row) => ({ key: row.key, name: row.name, priceFcfa: row.price_fcfa, description: row.description }));

  const limitByPlanAndKey = new Map<string, number>();
  for (const row of entitlementRows ?? []) {
    limitByPlanAndKey.set(`${row.plan_key}:${row.entitlement_key}`, row.limit_value);
  }

  function buildMatrix(catalog: { key: string; label: string }[], defaultValue: number): AdminEntitlementMatrixEntry[] {
    return catalog.map((entry) => {
      const limitsByPlan = {} as Record<PlanKey, number>;
      for (const planKey of PLAN_KEYS) {
        limitsByPlan[planKey] = limitByPlanAndKey.get(`${planKey}:${entry.key}`) ?? defaultValue;
      }
      return { key: entry.key, label: entry.label, limitsByPlan };
    });
  }

  const entitlementCatalog = [...USAGE_GAUGES, ...FEATURE_FLAGS].map((entry) => ({ key: entry.key, label: entry.label }));

  return {
    plans,
    // Les jauges d'usage sont "-1 = illimité" par défaut si non configurées
    // (même sémantique que getEntitlementLimit — voir plans-repository.ts).
    entitlements: buildMatrix(entitlementCatalog, -1),
    // Un bonus non configuré n'a jamais de sens à "illimité" -> 0 par défaut.
    dedicatedBonuses: buildMatrix(DEDICATED_BONUS_CATALOG, 0),
  };
}

export async function updatePlanDetails(
  planKey: string,
  updates: { name: string; priceFcfa: number; description: string },
  actorUserId: string,
): Promise<void> {
  if (!isPlanKey(planKey)) {
    throw new ValidationError(`Plan invalide — attendu l'un de : ${PLAN_KEYS.join(", ")}`);
  }
  const name = updates.name.trim();
  if (!name) throw new ValidationError("Le nom du plan est requis.");
  if (!Number.isFinite(updates.priceFcfa) || updates.priceFcfa < 0) {
    throw new ValidationError("Le prix doit être un nombre positif.");
  }

  const supabase = getSupabaseServiceClient();
  const { data: before, error: fetchError } = await supabase
    .from("plans")
    .select("name, price_fcfa, description")
    .eq("key", planKey)
    .maybeSingle();
  if (fetchError) throw new Error(`Erreur lecture plans: ${fetchError.message}`);
  if (!before) throw new NotFoundError("Plan introuvable");

  const description = updates.description.trim() || null;
  const priceFcfa = Math.round(updates.priceFcfa);

  const { error } = await supabase
    .from("plans")
    .update({ name, price_fcfa: priceFcfa, description })
    .eq("key", planKey);
  if (error) throw new Error(`Erreur mise à jour du plan: ${error.message}`);

  // Clé texte ("starter"/"business"/"pro"), pas un uuid -> pas d'entityId
  // (entity_id est typé uuid en base, voir writeAdminAuditLog) ; la clé
  // vit dans before_state/after_state, même pattern que upsertTldPricing
  // ci-dessus et createAddon (admin-addons-service.ts).
  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    action: "PLAN_DETAILS_UPDATED",
    entityType: "plan",
    beforeState: { planKey, ...before },
    afterState: { planKey, name, priceFcfa, description },
  });
}

/**
 * Upsert d'une seule cellule de la grille (un plan × une clé
 * d'entitlement à la fois) plutôt qu'un update de masse : plus sûr pour
 * l'audit log (before/after précis) et évite qu'une faute de frappe sur
 * une cellule écrase involontairement toute la grille.
 */
export async function upsertPlanEntitlementLimit(
  planKey: string,
  entitlementKey: string,
  limitValue: number,
  actorUserId: string,
): Promise<void> {
  if (!isPlanKey(planKey)) {
    throw new ValidationError(`Plan invalide — attendu l'un de : ${PLAN_KEYS.join(", ")}`);
  }
  const knownKeys = new Set([
    ...USAGE_GAUGES.map((entry) => entry.key),
    ...FEATURE_FLAGS.map((entry) => entry.key),
    ...DEDICATED_BONUS_CATALOG.map((entry) => entry.key),
  ]);
  if (!knownKeys.has(entitlementKey)) {
    throw new ValidationError(`Clé d'entitlement inconnue: ${entitlementKey}`);
  }
  if (!Number.isFinite(limitValue) || (limitValue < 0 && limitValue !== -1)) {
    throw new ValidationError("La limite doit être un entier positif, ou -1 pour illimité.");
  }

  const supabase = getSupabaseServiceClient();
  const { data: before } = await supabase
    .from("plan_entitlements")
    .select("limit_value")
    .eq("plan_key", planKey)
    .eq("entitlement_key", entitlementKey)
    .maybeSingle();

  const { error } = await supabase
    .from("plan_entitlements")
    .upsert(
      { plan_key: planKey, entitlement_key: entitlementKey, limit_value: Math.round(limitValue) },
      { onConflict: "plan_key,entitlement_key" },
    );
  if (error) throw new Error(`Erreur mise à jour de l'entitlement: ${error.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    action: "PLAN_ENTITLEMENT_UPDATED",
    entityType: "plan_entitlement",
    beforeState: { planKey, entitlementKey, limitValue: before?.limit_value ?? null },
    afterState: { planKey, entitlementKey, limitValue: Math.round(limitValue) },
  });
}
