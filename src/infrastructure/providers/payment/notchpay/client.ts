import { env } from "@/lib/env";
import type {
  NotchPayCancelPaymentResponse,
  NotchPayCreatePaymentPayload,
  NotchPayCreatePaymentResponse,
  NotchPayRetrievePaymentResponse,
} from "./types";

/**
 * Client HTTP bas niveau. Aucune logique métier — uniquement la
 * traduction "appel HTTP <-> types NotchPay". L'adapter (adapter.ts) est
 * le seul consommateur légitime de ce client (même discipline que
 * ZernioClient).
 *
 * Endpoints et conventions CONFIRMÉS (developer.notchpay.co, consulté
 * 31 août 2026) :
 * - Base URL : https://api.notchpay.co (PAS de préfixe /v1 ou autre).
 * - Auth : header `Authorization: <clé publique>` — DIRECTEMENT la clé,
 *   sans préfixe "Bearer " (à la différence de ZernioClient). C'est une
 *   différence réelle entre les deux providers, pas un oubli.
 * - POST /payments — créer un paiement.
 * - GET /payments/{reference} — récupérer/vérifier un paiement.
 * - DELETE /payments/{reference} — annuler un paiement encore `pending`
 *   uniquement (422 si déjà processing/complete/failed).
 */
export class NotchPayClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string = env.NOTCHPAY_API_KEY ?? "", baseUrl: string = "https://api.notchpay.co") {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private assertConfigured() {
    if (!this.apiKey) {
      throw new Error(
        "NOTCHPAY_API_KEY manquant — configurez la variable d'environnement avant d'initier un paiement.",
      );
    }
  }

  private headers(): Record<string, string> {
    return { Authorization: this.apiKey, "Content-Type": "application/json" };
  }

  async createPayment(payload: NotchPayCreatePaymentPayload): Promise<NotchPayCreatePaymentResponse> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/payments`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`NotchPay createPayment failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<NotchPayCreatePaymentResponse>;
  }

  async retrievePayment(reference: string): Promise<NotchPayRetrievePaymentResponse> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(reference)}`, {
      headers: this.headers(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`NotchPay retrievePayment failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<NotchPayRetrievePaymentResponse>;
  }

  /** Confirmé : uniquement pour un paiement encore `pending` (voir adapter.ts). */
  async cancelPayment(reference: string): Promise<NotchPayCancelPaymentResponse> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(reference)}`, {
      method: "DELETE",
      headers: this.headers(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`NotchPay cancelPayment failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<NotchPayCancelPaymentResponse>;
  }
}
