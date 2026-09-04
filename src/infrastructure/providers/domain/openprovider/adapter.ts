import type {
  DomainDnsRecord,
  DomainProvider,
  DomainRegistrationResult,
  DomainSearchResult,
} from "@/domain/ports/domain-provider";
import { ManualDomainAdapter } from "../manual/adapter";
import { OpenProviderClient } from "./client";

/**
 * Lot N, Partie 2 — première intégration réelle d'un registrar (voir
 * RAPPORT_LOT_G.md pour l'évaluation initiale, RAPPORT_LOT_N.md pour le
 * détail). CONFORME au mandat V3 : "l'enregistrement effectif peut rester
 * une étape confirmée manuellement" — seules `search`/`checkAvailability`
 * sont réellement automatisées ici ; `register`/`configureDns`/`renew`
 * délèguent à `ManualDomainAdapter` (composé, jamais dupliqué) — mêmes
 * garanties, même table `domain_requests`, mêmes écrans Super Admin déjà
 * construits en Lot G.
 */
export class OpenProviderAdapter implements DomainProvider {
  readonly providerName = "openprovider";

  constructor(
    private readonly client: OpenProviderClient,
    private readonly manual: ManualDomainAdapter = new ManualDomainAdapter(),
  ) {}

  async search(query: string, tlds: string[]): Promise<DomainSearchResult[]> {
    const normalizedQuery = query.trim().toLowerCase();
    const domains = tlds.map((tld) => ({ name: normalizedQuery, extension: tld.replace(/^\./, "") }));

    const response = await this.client.checkDomains(domains, true);

    return response.data.results.map((r) => {
      const dotIndex = r.domain.indexOf(".");
      const tld = dotIndex >= 0 ? r.domain.slice(dotIndex) : "";
      return {
        domain: r.domain,
        tld,
        // CONFIRMÉ : "free" = disponible. Toute autre valeur (ex: "active")
        // est traitée comme NON disponible plutôt que de deviner le sens
        // exact de chaque statut possible non listé dans la doc consultée.
        available: r.status === "free",
        // Prix OpenProvider (coût fournisseur brut) volontairement PAS
        // renvoyé ici — domain-service.ts::checkDomainAvailability fusionne
        // le résultat de disponibilité avec le prix DE VENTE réel
        // (domain_tld_pricing, marge Marc-well incluse), qui reste la seule
        // source de prix affichée au tenant.
        priceFcfa: null,
      };
    });
  }

  async checkAvailability(domain: string): Promise<boolean> {
    const dotIndex = domain.indexOf(".");
    if (dotIndex < 0) throw new Error(`OpenProviderAdapter: "${domain}" n'est pas un nom de domaine valide.`);
    const name = domain.slice(0, dotIndex).toLowerCase();
    const extension = domain.slice(dotIndex + 1).toLowerCase();

    const response = await this.client.checkDomains([{ name, extension }], false);
    const result = response.data.results[0];
    return result?.status === "free";
  }

  register(domain: string, organizationId: string): Promise<DomainRegistrationResult> {
    return this.manual.register(domain, organizationId);
  }

  configureDns(domain: string, records: DomainDnsRecord[]): Promise<void> {
    return this.manual.configureDns(domain, records);
  }

  renew(domain: string, years: number): Promise<void> {
    return this.manual.renew(domain, years);
  }
}
