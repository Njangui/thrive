import { env } from "@/lib/env";
import type { FapshiInitiatePayPayload, FapshiInitiatePayResponse, FapshiTransaction } from "./types";

/**
 * Client HTTP Fapshi. Auto-contenu (même discipline que ZernioClient et
 * l'ancien NotchPayClient) : pas de dépendance vers l'adapter, ne connaît
 * rien de `PaymentProvider`.
 *
 * Auth CONFIRMÉE : deux en-têtes `apiuser` + `apikey` (PAS un unique
 * secret Bearer comme NotchPay) — c'est pourquoi ce provider n'est PAS
 * résolu via `resolveProviderCredential()`/`secrets-resolver.ts` (qui ne
 * gère qu'un seul secret par provider), exactement comme OpenProvider
 * (OPENPROVIDER_USERNAME/PASSWORD) déjà présent dans ce registry — voir
 * registry.ts.
 */
export class FapshiClient {
  constructor(
    private readonly apiUser: string | undefined,
    private readonly apiKey: string | undefined,
    private readonly baseUrlOverride: string | undefined = env.FAPSHI_BASE_URL,
  ) {}

  private get baseUrl(): string {
    return (this.baseUrlOverride ?? "").replace(/\/+$/, "");
  }

  private assertConfigured(): void {
    if (!this.baseUrlOverride) {
      throw new Error(
        "Fapshi: FAPSHI_BASE_URL manquant — mettez https://sandbox.fapshi.com (tests, aucun vrai argent) ou https://live.fapshi.com (production).",
      );
    }
    if (!this.apiUser || !this.apiKey) {
      throw new Error(
        "Fapshi: FAPSHI_API_USER/FAPSHI_API_KEY manquants — configurez ces variables avant d'initier un paiement.",
      );
    }
  }

  private headers(): Record<string, string> {
    return {
      apiuser: this.apiUser ?? "",
      apikey: this.apiKey ?? "",
      "Content-Type": "application/json",
    };
  }

  async initiatePay(payload: FapshiInitiatePayPayload): Promise<FapshiInitiatePayResponse> {
    this.assertConfigured();
    const res = await fetch(`${this.baseUrl}/initiate-pay`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Fapshi initiatePay a échoué (${res.status}): ${body}`);
    }
    return res.json() as Promise<FapshiInitiatePayResponse>;
  }

  /**
   * Statut d'une transaction. Documentation officielle (docs.fapshi.com, « payment-status ») :
   * `GET /payment-status/{transId}` — transId en SEGMENT DE CHEMIN.
   * Un correctif du 24/09/2026 était passé à `?transId=` après des « Invalid request URL » observés
   * en réel ; la cause n'a jamais été prouvée (clés/ID d'un autre environnement possible). Par prudence
   * on essaie la forme officielle d'abord, et on ne retombe sur la forme `?transId=` que sur un refus
   * « URL invalide » (400/404). L'URL exacte tentée figure dans le message d'erreur pour trancher au
   * premier test sandbox (décision Q34).
   */
  async paymentStatus(transId: string): Promise<FapshiTransaction> {
    this.assertConfigured();
    const encoded = encodeURIComponent(transId);
    const officialUrl = `${this.baseUrl}/payment-status/${encoded}`;
    let res = await fetch(officialUrl, { headers: this.headers() });
    let url = officialUrl;

    if (!res.ok && (res.status === 400 || res.status === 404)) {
      const firstBody = await res.clone().text().catch(() => "");
      if (/invalid request url/i.test(firstBody)) {
        const fallbackUrl = `${this.baseUrl}/payment-status?transId=${encoded}`;
        console.warn(`Fapshi paymentStatus: forme officielle refusée (« ${firstBody.slice(0, 80)} »), essai de la forme ?transId=.`);
        res = await fetch(fallbackUrl, { headers: this.headers() });
        url = fallbackUrl;
      }
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Fapshi paymentStatus a échoué (${res.status}): ${body} — URL tentée : ${url}`);
    }
    return res.json() as Promise<FapshiTransaction>;
  }

  /**
   * Expire un lien de paiement encore pending. Répond 400 si déjà
   * expiré/complété côté Fapshi — laissé remonter tel quel, l'appelant
   * (`cancelPendingPayment`) traite déjà tout échec provider comme
   * best-effort (log, jamais bloquant). Ne fonctionne que pour une
   * transaction créée via initiate-pay (jamais direct-pay, non utilisé
   * dans ce projet de toute façon — voir adapter).
   */
  async expirePay(transId: string): Promise<FapshiTransaction> {
    this.assertConfigured();
    const res = await fetch(`${this.baseUrl}/expire-pay`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ transId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Fapshi expirePay a échoué (${res.status}): ${body}`);
    }
    return res.json() as Promise<FapshiTransaction>;
  }
}