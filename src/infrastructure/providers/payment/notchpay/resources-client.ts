import { env } from "@/lib/env";
import type {
  NotchPayGetCountryResponse,
  NotchPayListChannelsResponse,
  NotchPayListCountriesResponse,
} from "./types";

/**
 * Client HTTP bas niveau pour la Resources API de NotchPay (Country
 * Engine, section 8). Distinct de `NotchPayClient` (client.ts,
 * paiements uniquement) : les deux partagent le même compte/clé API
 * mais des préoccupations totalement différentes (payer un abonnement
 * vs. synchroniser un catalogue de capacités) — même séparation que le
 * projet applique déjà entre `payment-provider.ts` (port swappable) et
 * ce client, qui n'a PAS vocation à être swappable (la synchronisation
 * de ressources est spécifique à NotchPay par construction : un futur
 * second provider de paiement aurait son propre catalogue de pays/
 * canaux, pas interchangeable via une interface commune sans données
 * réelles sur sa forme — section 49, ne pas sur-engineer une
 * abstraction non encore nécessaire).
 *
 * Endpoints CONFIRMÉS (developer.notchpay.co/api-reference/resources,
 * consulté 06/09/2026 — voir docs/notchpay-resources.md pour le détail
 * des réponses complètes) :
 * - GET /resources/countries — pays supportés (avec devise/indicatif/
 *   canaux larges), PAS `GET /countries` (liste générique mondiale,
 *   ressource différente, non utilisée ici).
 * - GET /resources/countries/{code} — détail d'un pays + channels
 *   individuels.
 * - GET /resources/channels?country={code} — canaux de paiement
 *   individuels (ex: cm.mtn), filtrables par pays.
 *
 * Même convention d'authentification que `NotchPayClient` (header
 * `Authorization: <clé>`, sans préfixe Bearer) — la documentation ne
 * précise pas explicitement si ces endpoints Resources exigent une
 * authentification (contrairement à `/payments`, confirmé), mais
 * l'envoyer systématiquement est sans risque et cohérent avec le reste
 * de l'intégration.
 */
export class NotchPayResourcesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string = env.NOTCHPAY_API_KEY ?? "", baseUrl: string = "https://api.notchpay.co") {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private assertConfigured() {
    if (!this.apiKey) {
      throw new Error(
        "NOTCHPAY_API_KEY manquant — configurez la variable d'environnement avant de synchroniser les ressources NotchPay.",
      );
    }
  }

  private headers(): Record<string, string> {
    return { Authorization: this.apiKey, "Content-Type": "application/json" };
  }

  async listCountries(): Promise<NotchPayListCountriesResponse> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/resources/countries`, { headers: this.headers() });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`NotchPay listCountries failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<NotchPayListCountriesResponse>;
  }

  async getCountry(isoCode: string): Promise<NotchPayGetCountryResponse> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/resources/countries/${encodeURIComponent(isoCode)}`, {
      headers: this.headers(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`NotchPay getCountry(${isoCode}) failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<NotchPayGetCountryResponse>;
  }

  /** `countryCode` filtre côté serveur NotchPay (`?country=`) — évite de récupérer TOUS les canaux mondiaux pour ne garder qu'un pays. */
  async listChannels(countryCode?: string): Promise<NotchPayListChannelsResponse> {
    this.assertConfigured();

    const url = new URL(`${this.baseUrl}/resources/channels`);
    if (countryCode) url.searchParams.set("country", countryCode);

    const res = await fetch(url.toString(), { headers: this.headers() });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`NotchPay listChannels(${countryCode ?? "*"}) failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<NotchPayListChannelsResponse>;
  }
}
