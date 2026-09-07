/**
 * PaymentProvider — port métier (section 29).
 * OrderService / PaymentService dépendent de ceci, jamais d'un SDK
 * CinetPay/NotchPay/MTN/Orange directement.
 */

export interface CreatePaymentRequest {
  organizationId: string;
  orderId: string;
  amount: number;
  currency: string;
  customerPhone?: string;
  /** Ajout Lot G : NotchPay accepte email OU phone OU customer — voir adapter. */
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
   * déjà `succeeded`/`failed` — capacité confirmée côté NotchPay
   * uniquement en `pending`, voir adapter). Optionnelle : un futur
   * provider qui ne supporterait pas l'annulation reste conforme au port
   * sans avoir à lever une erreur "non supporté" à l'exécution.
   * Ajout Lot G (premier implémenteur réel de ce port).
   */
  cancelPayment?(providerReference: string): Promise<void>;
}
