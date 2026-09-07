import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { ModuleKey } from "@/application/config/modules";

/**
 * Section 33 : toute route, server action ou widget sensible à un module
 * doit appeler ceci avant d'exécuter la logique correspondante.
 *
 *   if (!(await isModuleEnabled(orgId, "inventory"))) {
 *     return forbidden("Module inventory désactivé pour ce tenant");
 *   }
 */
export async function isModuleEnabled(organizationId: string, module: ModuleKey): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenant_modules")
    .select("enabled")
    .eq("organization_id", organizationId)
    .eq("module", module)
    .maybeSingle();

  if (error) {
    // Fail-closed : en cas d'erreur de lecture, on considère le module
    // désactivé plutôt que d'exposer une fonctionnalité par défaut.
    console.error(`isModuleEnabled(${organizationId}, ${module}) error:`, error.message);
    return false;
  }

  return data?.enabled ?? false;
}

export async function getEnabledModules(organizationId: string): Promise<ModuleKey[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenant_modules")
    .select("module")
    .eq("organization_id", organizationId)
    .eq("enabled", true);

  if (error) {
    console.error(`getEnabledModules(${organizationId}) error:`, error.message);
    return [];
  }

  return (data ?? []).map((row) => row.module as ModuleKey);
}
