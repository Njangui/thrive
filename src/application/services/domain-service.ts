import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError } from "@/lib/errors";
import { getDomainProvider } from "@/infrastructure/providers/registry";
import { notifyOrgAdmins } from "./notification-service";

/**
 * Lot G, Partie 3 — face tenant. Le cahier (07_LOT_G) ne liste que
 * `/admin/domains` dans sa section UI, mais son propre schéma
 * (`domain_requests.organization_id`) suppose qu'une organisation peut
 * en créer une — sans point d'entrée tenant, la fonctionnalité ne serait
 * jamais atteignable. Ajout délibéré, documenté dans RAPPORT_LOT_G.md :
 * une petite section sur /dashboard/site permet de déclarer une demande,
 * consommée exactement par le même DomainProvider que l'admin gère.
 */

export interface TldPricingOption {
  tld: string;
  soldPriceFcfa: number;
}

export async function listActiveTldPricing(): Promise<TldPricingOption[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("domain_tld_pricing")
    .select("tld, supplier_price_fcfa, margin_fcfa")
    .eq("active", true)
    .order("tld");

  if (error) throw new Error(`Erreur lecture domain_tld_pricing: ${error.message}`);

  return (data ?? []).map((r) => ({ tld: r.tld, soldPriceFcfa: r.supplier_price_fcfa + r.margin_fcfa }));
}

export interface DomainRequestSummary {
  id: string;
  domainName: string;
  status: string;
  soldPriceFcfa: number;
  requestedAt: string;
  resolvedAt: string | null;
}

export async function listMyDomainRequests(organizationId: string): Promise<DomainRequestSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("domain_requests")
    .select("id, domain_name, status, sold_price_fcfa, requested_at, resolved_at")
    .eq("organization_id", organizationId)
    .order("requested_at", { ascending: false });

  if (error) throw new Error(`Erreur lecture domain_requests: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    domainName: r.domain_name,
    status: r.status,
    soldPriceFcfa: r.sold_price_fcfa,
    requestedAt: r.requested_at,
    resolvedAt: r.resolved_at,
  }));
}

const DOMAIN_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
/** Juste le nom (sans extension) — utilisé par checkDomainAvailability, qui teste plusieurs extensions à la fois. */
const DOMAIN_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export interface DomainAvailabilityResult {
  domain: string;
  tld: string;
  /** null = disponibilité non vérifiable (ManualDomainAdapter, aucun registrar branché — voir requestDomain). */
  available: boolean | null;
  priceFcfa: number | null;
}

/**
 * Lot N, Partie 2 — recherche en direct depuis /dashboard/site (debounce
 * côté Client Component, voir domain-search-actions.ts). Interroge
 * TOUTES les extensions actives en un seul appel provider.
 *
 * Dégrade PROPREMENT vers la seule grille tarifaire (available: null)
 * quand le provider actif ne sait pas vérifier de disponibilité réelle
 * (ManualDomainAdapter — aucun registrar configuré) plutôt que de faire
 * échouer toute la recherche : voir infrastructure/providers/domain/manual/adapter.ts,
 * qui lève délibérément une erreur explicite pour `search()`.
 */
export async function checkDomainAvailability(nameWithoutTld: string): Promise<DomainAvailabilityResult[]> {
  const normalized = nameWithoutTld.trim().toLowerCase();
  if (!DOMAIN_LABEL_PATTERN.test(normalized)) {
    throw new ValidationError('Nom de domaine invalide (ex: "boutique-fatou", sans extension).');
  }

  const pricing = await listActiveTldPricing();
  if (pricing.length === 0) return [];

  const pricingByTld = new Map(pricing.map((p) => [p.tld, p.soldPriceFcfa]));
  const tlds = pricing.map((p) => p.tld.replace(/^\./, ""));

  try {
    // "" = pas de tenant particulier : le DomainProvider est un provider
    // plateforme unique, jamais résolu par organisation (voir registry.ts).
    const provider = await getDomainProvider("");
    const results = await provider.search(normalized, tlds);
    return results.map((r) => ({
      domain: r.domain,
      tld: r.tld,
      available: r.available,
      priceFcfa: pricingByTld.get(r.tld) ?? r.priceFcfa,
    }));
  } catch (err) {
    console.warn(
      `checkDomainAvailability(${normalized}): recherche live indisponible, repli sur la grille tarifaire seule:`,
      err,
    );
    return pricing.map((p) => ({
      domain: `${normalized}${p.tld}`,
      tld: p.tld,
      available: null,
      priceFcfa: p.soldPriceFcfa,
    }));
  }
}

/** Passe par DomainProvider.register() (ManualDomainAdapter) — jamais un insert direct ici, même discipline "port only" que le reste du projet. */
export async function requestDomain(
  organizationId: string,
  domainName: string,
  actorUserId: string,
): Promise<{ requestId: string }> {
  const normalized = domainName.trim().toLowerCase();
  if (!DOMAIN_NAME_PATTERN.test(normalized)) {
    throw new ValidationError('Nom de domaine invalide (ex: "boutique-fatou.cm").');
  }

  const provider = await getDomainProvider(organizationId);
  const result = await provider.register(normalized, organizationId);

  console.info(
    `[audit] actor=${actorUserId} org=${organizationId} action=DOMAIN_REQUESTED domain=${normalized} requestId=${result.requestId}`,
  );

  await notifyOrgAdmins({
    organizationId,
    title: "Demande de domaine envoyée.",
    body: `Votre demande pour ${normalized} a été transmise à notre équipe et sera traitée sous peu.`,
    relatedEntityType: "domain_request",
    relatedEntityId: result.requestId,
  });

  return { requestId: result.requestId };
}
