import { env } from "@/lib/env";
import type {
  ZernioSendInboxMessagePayload,
  ZernioSendInboxMessageResponse,
  ZernioAccount,
} from "./types";

/**
 * Client HTTP bas niveau. Ne contient aucune logique métier — uniquement
 * la traduction "appel HTTP <-> types Zernio". L'adapter (adapter.ts) est
 * le seul consommateur légitime de ce client.
 *
 * Endpoints CONFIRMÉS (docs.zernio.com, consulté 27 août 2026) :
 * - POST /inbox/conversations/{conversationId}/messages — répondre dans
 *   une conversation existante (le seul flux utilisé en V1, section 13/17
 *   doc 2 : on répond toujours à un message entrant, jamais un envoi
 *   "à froid").
 * - GET /accounts?profileId=... — lister les comptes connectés d'un tenant.
 */
export class ZernioClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string = env.ZERNIO_API_KEY ?? "", baseUrl: string = env.ZERNIO_API_BASE_URL) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private assertConfigured() {
    if (!this.apiKey) {
      throw new Error(
        "ZERNIO_API_KEY manquant — connectez le provider dans provider_connections avant d'envoyer des messages.",
      );
    }
  }

  /** Répond dans une conversation inbox existante (confirmé — Quickstart "Reply to a DM"). */
  async sendInboxMessage(
    conversationId: string,
    payload: ZernioSendInboxMessagePayload,
  ): Promise<ZernioSendInboxMessageResponse> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/inbox/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio sendInboxMessage failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<ZernioSendInboxMessageResponse>;
  }

  /** Liste les comptes connectés d'un profile (tenant) — confirmé. */
  async listAccounts(profileId: string): Promise<ZernioAccount[]> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/accounts?profileId=${encodeURIComponent(profileId)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Zernio listAccounts failed (${res.status})`);
    }

    const data = (await res.json()) as { accounts: ZernioAccount[] };
    return data.accounts ?? [];
  }
}
