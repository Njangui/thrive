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
}
