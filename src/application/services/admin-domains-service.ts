import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

export interface AdminDomainListItem {
  id: string;
  domain: string;
  organizationId: string;
  organizationName: string;
  isPrimary: boolean;
  verified: boolean;
  createdAt: string;
}

/**
 * Section 45 (route `/admin/domains`) : toutes les lignes `tenant_domains`
 * (table déjà existante, migration 0001) tous tenants confondus.
 */
export async function listDomainsForAdmin(): Promise<AdminDomainListItem[]> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("tenant_domains")
    .select("id, domain, is_primary, verified, created_at, organization_id, organizations(name)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Erreur lecture tenant_domains: ${error.message}`);

  return (data ?? []).map((d) => ({
    id: d.id,
    domain: d.domain,
    organizationId: d.organization_id,
    organizationName: (d as unknown as { organizations?: { name?: string } }).organizations?.name ?? "",
    isPrimary: d.is_primary,
    verified: d.verified,
    createdAt: d.created_at,
  }));
}
