/**
 * Types OpenProvider — CONFIRMÉS via support.openprovider.eu (consulté
 * 31 août 2026 : "Getting started with Openprovider API",
 * "2 Domains API: Check Domain"). Voir RAPPORT_LOT_N.md pour le verdict
 * complet.
 */

export interface OpenProviderLoginResponse {
  data: {
    token: string;
    reseller_id: number;
  };
}

export interface OpenProviderCheckDomainRequest {
  domains: Array<{ name: string; extension: string }>;
  with_price: boolean;
  with_whois: boolean;
}

export interface OpenProviderDomainCheckResult {
  domain: string;
  status: string; // "free" = disponible (confirmé) — les autres valeurs ("active", ...) ne sont pas exhaustivement documentées, traitées comme "non disponible" par prudence (voir adapter).
  is_premium?: 0 | 1;
  reason?: string;
  price?: {
    product?: { currency: string; price: number };
    reseller?: { currency: string; price: number };
  };
}

export interface OpenProviderCheckDomainResponse {
  code: number; // 0 = succès
  desc: string;
  data: {
    results: OpenProviderDomainCheckResult[];
  };
}
