/**
 * Types Fapshi — CONFIRMÉ via docs.fapshi.com/en/api-reference (recherche
 * web, ce fichier n'a jamais tourné contre l'API réelle dans cet
 * environnement, pas de réseau disponible ici). À revalider en sandbox
 * (sandbox.fapshi.com) avant toute mise en production.
 *
 * Différence structurelle majeure avec NotchPay, qui conditionne tout
 * l'adapter et le webhook-handler de ce dossier : Fapshi GÉNÈRE
 * lui-même `transId` (jamais une référence qu'on lui fournirait) — on ne
 * peut donc connaître la référence provider qu'APRÈS l'appel à
 * `initiate-pay`, jamais avant. Voir `PaymentProvider.createPayment` et
 * le commentaire de `getPaymentProvider()` dans registry.ts.
 */

/** Statuts confirmés d'une transaction Fapshi (réponse payment-status ET payload webhook, même forme). */
export type FapshiTransactionStatus = "CREATED" | "PENDING" | "SUCCESSFUL" | "FAILED" | "EXPIRED";

export interface FapshiInitiatePayPayload {
  /** Montant en XAF, entier, minimum 100 (confirmé par la doc). */
  amount: number;
  /** Si fourni, le payeur n'a pas à ressaisir son email sur la page Fapshi. */
  email?: string;
  /** Page de retour après paiement. Laissé vide ici — voir note dans l'adapter (parité avec le comportement NotchPay précédent, jamais configuré non plus). */
  redirectUrl?: string;
  /** 1-100 caractères alphanumériques/-_/ — utilisé ici pour organizationId (aide à la réconciliation manuelle côté dashboard Fapshi). */
  userId?: string;
  /** 1-100 caractères alphanumériques/-_/ — utilisé ici pour notre paymentId local (subscription_payments.id). CE N'EST PAS la référence provider : Fapshi ne renvoie pas cette valeur telle quelle, voir types ci-dessus. */
  externalId?: string;
  /** Max 200 caractères, affiché sur la page de paiement Fapshi. */
  message?: string;
}

export interface FapshiInitiatePayResponse {
  message: string;
  /** URL de la page de paiement hébergée, valide 24h. */
  link: string;
  /** Référence provider — générée par Fapshi, JAMAIS égale à externalId. */
  transId: string;
  dateInitiated: string;
}

/**
 * Objet Transaction — forme confirmée identique entre la réponse
 * GET /payment-status/:transId ET le corps du webhook (pas d'enveloppe
 * {event, data} comme NotchPay : le webhook Fapshi EST directement cet
 * objet).
 */
export interface FapshiTransaction {
  transId: string;
  status: FapshiTransactionStatus;
  medium?: "mobile money" | "orange money";
  serviceName?: string;
  transType?: "Collection" | "Payout";
  amount: number;
  revenue?: number;
  payerName?: string;
  email?: string;
  redirectUrl?: string;
  externalId?: string;
  userId?: string;
  webhook?: string;
  financialTransId?: string;
  dateInitiated?: string;
  dateConfirmed?: string;
}

/** Payload webhook — même forme que FapshiTransaction (confirmé par la doc), aliasé pour la lisibilité des imports côté webhook-handler/route. */
export type FapshiWebhookEvent = FapshiTransaction;
