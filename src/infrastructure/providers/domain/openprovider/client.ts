import type {
  OpenProviderCheckDomainResponse,
  OpenProviderLoginResponse,
} from "./types";

/**
 * Client HTTP bas niveau. Aucune logique métier — traduction "appel HTTP
 * <-> types OpenProvider" uniquement, comme NotchPayClient/ZernioClient.
 *
 * Endpoints et conventions CONFIRMÉS (support.openprovider.eu, consulté
 * 31 août 2026) :
 * - Base URL : https://api.openprovider.eu/v1beta
 * - Auth : POST /auth/login avec {username, password, ip} -> {data:
 *   {token, reseller_id}} — PAS de préfixe "Bearer" dans le BODY de login
 *   (c'est un login classique), mais les appels SUIVANTS utilisent bien
 *   `Authorization: Bearer <token>`.
 * - POST /domains/check avec {domains: [{name, extension}], with_price,
 *   with_whois} -> {code, desc, data: {results: [...]}}.
 *
 * NON CONFIRMÉ (voir RAPPORT_LOT_N.md) : durée de validité du token —
 * aucune doc consultée ne précise de TTL exact. Par prudence, ce client
 * NE cache PAS le token entre deux instances (une ré-authentification par
 * recherche) plutôt que de deviner une durée de cache — un point
 * d'optimisation documenté pour une fois le compte de production
 * disponible et le comportement réel observable.
 */
export class OpenProviderClient {
  private readonly baseUrl = "https://api.openprovider.eu/v1beta";

  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {}

  private async login(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password, ip: "0.0.0.0" }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenProvider auth/login failed (${res.status}): ${body}`);
    }

    const payload = (await res.json()) as OpenProviderLoginResponse;
    return payload.data.token;
  }

  async checkDomains(
    domains: Array<{ name: string; extension: string }>,
    withPrice = true,
  ): Promise<OpenProviderCheckDomainResponse> {
    const token = await this.login();

    const res = await fetch(`${this.baseUrl}/domains/check`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ domains, with_price: withPrice, with_whois: false }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenProvider domains/check failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<OpenProviderCheckDomainResponse>;
  }
}
