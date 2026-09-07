import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Lot 4 — accès bas niveau, minimal et sans dépendance, à `phone_numbers`
 * (0017_phone_numbers.sql). Fichier séparé de `admin-numbers-service.ts`
 * pour la même raison que `plans-repository.ts` est séparé
 * d'`entitlements-service.ts` (voir son commentaire d'en-tête) :
 * `entitlements-service.ts` a besoin de savoir si une organisation a un
 * numéro dédié assigné (bonus "+N groupes", section 55 du master
 * prompt) sans dépendre du module `admin-*` (réservé aux écrans/actions
 * Super Admin) — ce module neutre est importable des deux côtés sans
 * créer de dépendance "cœur métier -> admin".
 *
 * Ne lève jamais : un tenant sans numéro dédié (l'immense majorité) doit
 * dégrader vers `false`, jamais faire planter une vérification
 * d'entitlement (même discipline que le reste de plans-repository.ts).
 */
export async function hasDedicatedPhoneNumber(organizationId: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("phone_numbers")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "assigned")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`hasDedicatedPhoneNumber(${organizationId}) erreur de lecture, false par défaut:`, error.message);
    return false;
  }
  return data !== null;
}
