/**
 * PaymentProvider — port métier (section 29). Le seul endroit du code
 * autorisé à connaître un provider concret (Fapshi, ou un futur
 * CinetPay/autre) est `registry.ts` + le dossier `payment/<provider>/` de
 * cet adapter — voir registry.ts::getPaymentProvider() pour la checklist
 * complète d'ajout d'un nouveau provider.
 * OrderService / PaymentService dépendent de ceci, jamais d'un SDK
 * concret directement.
 */

export interface CreatePaymentRequest {
  organizationId: string;
  orderId: string;
  amount: number;
  currency: string;
  customerPhone?: string;
  /** Ajout Lot G : tous les appelants actuels transmettent un email (jamais un phone) — voir chaque adapter pour ce qu'il accepte réellement en pratique. */
  customerEmail?: string;
  description?: string;
}

export interface CreatePaymentResult {
  providerReference: string;
  /** URL de paiement à ouvrir/rediriger si le provider en fournit une */
  paymentUrl?: string;
  status: "pending" | "succeeded" | "failed";
}

export interface PaymentStatusResult {
  providerReference: string;
  status: "pending" | "succeeded" | "failed" | "refunded";
  rawPayload: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly providerName: string;

  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult>;

  verifyPayment(providerReference: string): Promise<PaymentStatusResult>;

  getPaymentStatus(providerReference: string): Promise<PaymentStatusResult>;

  /**
   * Annule un paiement encore `pending` côté provider (jamais un paiement
   * déjà `succeeded`/`failed` — capacité confirmée en pratique uniquement
   * tant que le paiement est `pending`, voir chaque adapter). Optionnelle :
   * un futur provider qui ne supporterait pas l'annulation reste conforme
   * au port sans avoir à lever une erreur "non supporté" à l'exécution.
   * Ajout Lot G (premier implémenteur réel de ce port : NotchPay à
   * l'origine, migré vers Fapshi le 2026-09-20).
   */
  cancelPayment?(providerReference: string): Promise<void>;
}
