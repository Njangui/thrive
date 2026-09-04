import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { writeAdminAuditLog } from "./admin-organizations-service";
import { notifyOrgAdmins } from "./notification-service";

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

/**
 * Lot G, Partie 3 — section "Tarification" de /admin/domains. Prix vendu
 * calculé à la volée (supplier + margin), jamais stocké — voir
 * 0021_domain_pricing.sql.
 */
export interface DomainTldPricingItem {
  tld: string;
  supplierPriceFcfa: number;
  marginFcfa: number;
  soldPriceFcfa: number;
  active: boolean;
}

export async function listTldPricingForAdmin(): Promise<DomainTldPricingItem[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("domain_tld_pricing").select("*").order("tld");
  if (error) throw new Error(`Erreur lecture domain_tld_pricing: ${error.message}`);

  return (data ?? []).map((r) => ({
    tld: r.tld,
    supplierPriceFcfa: r.supplier_price_fcfa,
    marginFcfa: r.margin_fcfa,
    soldPriceFcfa: r.supplier_price_fcfa + r.margin_fcfa,
    active: r.active,
  }));
}

/** Crée ou met à jour la ligne de tarification pour un TLD (même pattern que les add-ons — un formulaire, upsert par clé naturelle). */
export async function upsertTldPricing(
  tld: string,
  supplierPriceFcfa: number,
  marginFcfa: number,
  active: boolean,
  actorUserId: string,
): Promise<void> {
  const normalizedTld = tld.trim().toLowerCase();
  if (!normalizedTld.startsWith(".") || normalizedTld.length < 2) {
    throw new ValidationError('L\'extension doit commencer par un point (ex: ".cm", ".com").');
  }
  if (supplierPriceFcfa < 0 || marginFcfa < 0) {
    throw new ValidationError("Le prix fournisseur et la marge doivent être positifs.");
  }

  const supabase = getSupabaseServiceClient();
  const { data: before } = await supabase.from("domain_tld_pricing").select("*").eq("tld", normalizedTld).maybeSingle();

  const { error } = await supabase.from("domain_tld_pricing").upsert(
    { tld: normalizedTld, supplier_price_fcfa: supplierPriceFcfa, margin_fcfa: marginFcfa, active },
    { onConflict: "tld" },
  );
  if (error) throw new Error(`Impossible d'enregistrer la tarification: ${error.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    action: before ? "DOMAIN_TLD_PRICING_UPDATED" : "DOMAIN_TLD_PRICING_CREATED",
    entityType: "domain_tld_pricing",
    beforeState: before ?? null,
    afterState: { tld: normalizedTld, supplierPriceFcfa, marginFcfa, active },
  });
}

/**
 * Lot G, Partie 3 — section "Demandes" de /admin/domains. File de
 * traitement manuel (ManualDomainAdapter n'enregistre jamais rien
 * automatiquement, voir infrastructure/providers/domain/manual/adapter.ts).
 */
export interface DomainRequestListItem {
  id: string;
  organizationId: string;
  organizationName: string;
  domainName: string;
  tld: string;
  status: string;
  supplierPriceFcfa: number;
  soldPriceFcfa: number;
  requestedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export async function listDomainRequestsForAdmin(): Promise<DomainRequestListItem[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("domain_requests")
    .select(
      "id, organization_id, domain_name, tld, status, supplier_price_fcfa, sold_price_fcfa, requested_at, resolved_at, resolution_note, organizations(name)",
    )
    .order("requested_at", { ascending: false });

  if (error) throw new Error(`Erreur lecture domain_requests: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    organizationName: (r as unknown as { organizations?: { name?: string } }).organizations?.name ?? "",
    domainName: r.domain_name,
    tld: r.tld,
    status: r.status,
    supplierPriceFcfa: r.supplier_price_fcfa,
    soldPriceFcfa: r.sold_price_fcfa,
    requestedAt: r.requested_at,
    resolvedAt: r.resolved_at,
    resolutionNote: r.resolution_note,
  }));
}

const FINAL_DOMAIN_REQUEST_STATUSES = new Set(["registered", "failed", "cancelled"]);

/** Résolution manuelle d'une demande — seule façon dont une demande change de statut (voir cahier, aucun automatisme). */
export async function resolveDomainRequest(
  requestId: string,
  newStatus: "processing" | "registered" | "failed" | "cancelled",
  actorUserId: string,
  resolutionNote?: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data: before, error: beforeError } = await supabase
    .from("domain_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (beforeError) throw new Error(`Erreur lecture domain_requests: ${beforeError.message}`);
  if (!before) throw new NotFoundError("Demande de domaine introuvable.");

  const isFinal = FINAL_DOMAIN_REQUEST_STATUSES.has(newStatus);

  const { error } = await supabase
    .from("domain_requests")
    .update({
      status: newStatus,
      resolution_note: resolutionNote ?? before.resolution_note,
      resolved_at: isFinal ? new Date().toISOString() : before.resolved_at,
    })
    .eq("id", requestId);

  if (error) throw new Error(`Impossible de mettre à jour la demande: ${error.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId: before.organization_id,
    action: "DOMAIN_REQUEST_RESOLVED",
    entityType: "domain_request",
    entityId: requestId,
    beforeState: { status: before.status },
    afterState: { status: newStatus, resolutionNote: resolutionNote ?? before.resolution_note },
  });

  if (newStatus === "registered") {
    await notifyOrgAdmins({
      organizationId: before.organization_id,
      title: "Domaine enregistré.",
      body: `Le domaine ${before.domain_name} a été enregistré avec succès.`,
      relatedEntityType: "domain_request",
      relatedEntityId: requestId,
    });
  } else if (newStatus === "failed") {
    await notifyOrgAdmins({
      organizationId: before.organization_id,
      title: "Demande de domaine échouée.",
      body: `La demande pour ${before.domain_name} n'a pas pu aboutir.${resolutionNote ? ` (${resolutionNote})` : ""}`,
      relatedEntityType: "domain_request",
      relatedEntityId: requestId,
    });
  }
}
