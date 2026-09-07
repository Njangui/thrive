import type { ResendErrorResponse, ResendSendEmailPayload, ResendSendEmailResponse } from "./types";

/**
 * Client HTTP bas niveau — aucune logique métier, même discipline que
 * ZernioClient/NotchPayClient. Seul l'adapter (adapter.ts) doit
 * l'utiliser.
 */
export class ResendClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string, baseUrl: string = "https://api.resend.com") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private assertConfigured() {
    if (!this.apiKey) {
      throw new Error("RESEND_API_KEY manquant — ResendClient ne devrait pas être instancié sans clé (voir registry.ts::getEmailProvider).");
    }
  }

  async sendEmail(payload: ResendSendEmailPayload): Promise<ResendSendEmailResponse> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const errorBody = body as ResendErrorResponse | null;
      throw new Error(
        `Resend sendEmail failed (${res.status}${errorBody?.name ? ` ${errorBody.name}` : ""}): ` +
          `${errorBody?.message ?? "réponse illisible"}`,
      );
    }

    return body as ResendSendEmailResponse;
  }
}
