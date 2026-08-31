import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

export interface AdminChannelListItem {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  providerType: string;
  providerName: string;
  status: string;
  updatedAt: string;
}

/**
 * Section 45 (route `/admin/channels`) : vue de `provider_connections`
 * tous tenants confondus.
 *
 * Sécurité (03_LOT_C_super_admin.md) : ne JAMAIS sélectionner
 * `credential_reference` ici, même en lecture — uniquement des statuts.
 *
 * `provider_connections` n'a pas de colonne dédiée "dernière activité" ni
 * "message d'erreur" (migration 0005) : `updatedAt` est le proxy le plus
 * honnête disponible (mis à jour par le trigger existant à chaque
 * changement de statut), et `status` (qui inclut la valeur `'error'`)
 * fait office de signal d'erreur — pas de détail texte inventé.
 */
export async function listChannelsForAdmin(): Promise<AdminChannelListItem[]> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("provider_connections")
    .select("id, organization_id, provider_type, provider_name, status, updated_at, organizations(name, slug)")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Erreur lecture provider_connections: ${error.message}`);

  return (data ?? []).map((c) => ({
    id: c.id,
    organizationId: c.organization_id,
    organizationName: (c as unknown as { organizations?: { name?: string } }).organizations?.name ?? "",
    organizationSlug: (c as unknown as { organizations?: { slug?: string } }).organizations?.slug ?? "",
    providerType: c.provider_type,
    providerName: c.provider_name,
    status: c.status,
    updatedAt: c.updated_at,
  }));
}
