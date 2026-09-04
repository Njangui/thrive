/**
 * DomainProvider — port métier (Lot G, Partie 3).
 * Même discipline que MessagingProvider/PaymentProvider : le reste de
 * l'application dépend de ceci, jamais d'un SDK de registrar directement.
 *
 * ÉTAT ACTUEL (voir RAPPORT_LOT_G.md) : aucun registrar avec API publique
 * en self-service couvrant le .cm n'a été identifié dans le temps
 * imparti — le seul adapter branché (`ManualDomainAdapter`) implémente
 * CE PORT en transformant `register()` en demande humaine plutôt qu'un
 * faux achat automatique. `search`, `checkAvailability`, `configureDns`
 * et `renew` lèvent délibérément une erreur explicite plutôt que de
 * mentir sur une capacité qui n'existe pas — voir adapter.ts.
 */

export interface DomainSearchResult {
  domain: string;
  tld: string;
  /** null = disponibilité non vérifiable par ce provider (voir ManualDomainAdapter). */
  available: boolean | null;
  priceFcfa: number | null;
}

export interface DomainRegistrationResult {
  requestId: string;
  status: "requested" | "processing" | "registered" | "failed";
}

export interface DomainDnsRecord {
  type: "A" | "AAAA" | "CNAME" | "TXT" | "MX";
  name: string;
  value: string;
  ttl?: number;
}

export interface DomainProvider {
  readonly providerName: string;

  /** Recherche de disponibilité/prix sur un ou plusieurs TLD. */
  search(query: string, tlds: string[]): Promise<DomainSearchResult[]>;

  checkAvailability(domain: string): Promise<boolean>;

  register(domain: string, organizationId: string): Promise<DomainRegistrationResult>;

  configureDns(domain: string, records: DomainDnsRecord[]): Promise<void>;

  renew(domain: string, years: number): Promise<void>;
}
