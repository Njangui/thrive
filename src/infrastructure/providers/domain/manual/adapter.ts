import { randomUUID } from "node:crypto";
import type {
  DomainDnsRecord,
  DomainProvider,
  DomainRegistrationResult,
  DomainSearchResult,
} from "@/domain/ports/domain-provider";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Aucun registrar avec API publique en self-service couvrant le .cm
 * n'a été trouvé dans le temps imparti — voir RAPPORT_LOT_G.md, section
 * "Domaines" (candidats évalués pour une future intégration : OpenProvider
 * en priorité — API REST self-service documentée, sandbox, ~1900 TLD ;
 * EuroDNS en second — couvre le .cm mais nécessite un contrat commercial
 * avant tout accès API, donc moins adapté à une intégration autonome).
 *
 * Cet adapter respecte le port SANS simuler une capacité inexistante :
 * `register()` transforme la demande en ligne `domain_requests` à
 * traiter manuellement (Super Admin, /admin/domains) ; les 4 autres
 * méthodes lèvent une erreur explicite plutôt que de renvoyer un faux
 * résultat.
 */
export class ManualDomainAdapter implements DomainProvider {
  readonly providerName = "manual";

  async search(_query: string, _tlds: string[]): Promise<DomainSearchResult[]> {
    throw new Error(
      "ManualDomainAdapter: recherche de disponibilité non supportée (aucun registrar branché) — " +
        "utilisez domain-service.ts::listActiveTldPricing() pour la grille tarifaire uniquement.",
    );
  }

  async checkAvailability(_domain: string): Promise<boolean> {
    throw new Error(
      "ManualDomainAdapter: vérification de disponibilité non supportée (aucun registrar branché) — " +
        "la disponibilité réelle est vérifiée manuellement par l'équipe au traitement de la demande.",
    );
  }

  /**
   * Seule capacité réellement implémentée : enregistre une DEMANDE
   * humaine (jamais un achat automatique). `requestId` = l'id de la
   * ligne `domain_requests` créée, immédiatement en statut `requested`.
   */
  async register(domain: string, organizationId: string): Promise<DomainRegistrationResult> {
    const supabase = getSupabaseServiceClient();
    const tld = extractTld(domain);

    const { data: pricing, error: pricingError } = await supabase
      .from("domain_tld_pricing")
      .select("tld, supplier_price_fcfa, margin_fcfa, active")
      .eq("tld", tld)
      .maybeSingle();

    if (pricingError) {
      throw new Error(`ManualDomainAdapter: erreur lecture tarification (${pricingError.message})`);
    }
    if (!pricing || !pricing.active) {
      throw new Error(`ManualDomainAdapter: extension "${tld}" non proposée à la vente actuellement.`);
    }

    const requestId = randomUUID();
    const { error: insertError } = await supabase.from("domain_requests").insert({
      id: requestId,
      organization_id: organizationId,
      domain_name: domain,
      tld,
      status: "requested",
      supplier_price_fcfa: pricing.supplier_price_fcfa,
      sold_price_fcfa: pricing.supplier_price_fcfa + pricing.margin_fcfa,
    });

    if (insertError) {
      throw new Error(`ManualDomainAdapter: échec création de la demande (${insertError.message})`);
    }

    return { requestId, status: "requested" };
  }

  async configureDns(_domain: string, _records: DomainDnsRecord[]): Promise<void> {
    throw new Error(
      "ManualDomainAdapter: configuration DNS non supportée (aucun registrar branché) — " +
        "à faire manuellement une fois le domaine effectivement enregistré (voir tenant_domains).",
    );
  }

  async renew(_domain: string, _years: number): Promise<void> {
    throw new Error("ManualDomainAdapter: renouvellement non supporté (aucun registrar branché).");
  }
}

/** '.cm' depuis 'boutique-fatou.cm' ; supporte les TLD à 2 segments (ex: '.com.cm'). */
function extractTld(domain: string): string {
  const parts = domain.trim().toLowerCase().split(".");
  if (parts.length < 2) {
    throw new Error(`ManualDomainAdapter: "${domain}" n'est pas un nom de domaine valide.`);
  }
  return `.${parts.slice(1).join(".")}`;
}
