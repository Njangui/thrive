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
    private readonly baseUrl: string = env.FAPSHI_BASE_URL,
  ) {}

  private assertConfigured(): void {
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

  async paymentStatus(transId: string): Promise<FapshiTransaction> {
    this.assertConfigured();
    const res = await fetch(`${this.baseUrl}/payment-status/${encodeURIComponent(transId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Fapshi paymentStatus a échoué (${res.status}): ${body}`);
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
