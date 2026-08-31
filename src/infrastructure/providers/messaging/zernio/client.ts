import { env } from "@/lib/env";
import type {
  ZernioSendInboxMessagePayload,
  ZernioSendInboxMessageResponse,
  ZernioAccount,
  ZernioListWhatsAppGroupsResponse,
  ZernioWhatsAppGroup,
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

  /**
   * Requête avec retry léger (backoff exponentiel) — UNIQUEMENT sur erreur
   * serveur transitoire (5xx) ou échec réseau. Jamais sur 4xx : un 4xx
   * reflète une erreur métier à remonter immédiatement (ex: numéro
   * connecté en mode Coexistence, voir listWhatsAppGroupsPage), pas une
   * panne passagère qu'un retry résoudrait.
   */
  private async fetchWithRetry(url: string, init: RequestInit, maxRetries = 2): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, init);
        if (res.status < 500) return res;
        lastError = new Error(`Zernio HTTP ${res.status}`);
      } catch (err) {
        lastError = err;
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Lot F — une page de `GET /whatsapp/wa-groups` (CONFIRMÉ,
   * docs.zernio.com/whatsapp/list-whatsapp-group-chats, 31 août 2026).
   * Non disponible pour les numéros connectés en mode Coexistence — Zernio
   * renvoie une erreur (400/403 selon la doc) que cette méthode propage
   * telle quelle, sans la masquer, pour que l'appelant l'affiche
   * honnêtement (voir docs/ZERNIO_INTEGRATION.md).
   */
  async listWhatsAppGroupsPage(
    accountId: string,
    options: { limit?: number; after?: string } = {},
  ): Promise<ZernioListWhatsAppGroupsResponse> {
    this.assertConfigured();

    const params = new URLSearchParams({ accountId, limit: String(options.limit ?? 100) });
    if (options.after) params.set("after", options.after);

    const res = await this.fetchWithRetry(`${this.baseUrl}/whatsapp/wa-groups?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio listWhatsAppGroups failed (${res.status}): ${body}`);
    }

    return (await res.json()) as ZernioListWhatsAppGroupsResponse;
  }

  /**
   * Parcourt toutes les pages (curseur `paging.cursors.after`, confirmé)
   * et retourne la liste complète des groupes actifs du compte. Plafonné
   * à 20 pages (2000 groupes à 100/page) — garde-fou raisonnable pour une
   * PME qui évite une boucle non bornée en cas de curseur inattendu, sans
   * jamais tronquer silencieusement un catalogue de groupes réaliste.
   */
  async listAllWhatsAppGroups(accountId: string): Promise<ZernioWhatsAppGroup[]> {
    const groups: ZernioWhatsAppGroup[] = [];
    let after: string | undefined;
    const HARD_CAP_PAGES = 20;

    for (let page = 0; page < HARD_CAP_PAGES; page++) {
      const response = await this.listWhatsAppGroupsPage(accountId, { limit: 100, after });
      const pageGroups = response.groups ?? [];
      groups.push(...pageGroups);

      const next = response.paging?.cursors?.after;
      if (!next || pageGroups.length === 0) break;
      after = next;
    }

    return groups;
  }
}
