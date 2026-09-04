/**
 * Types NotchPay — CONFIRMÉS via developer.notchpay.co (consulté 31 août
 * 2026 : /api-reference/payments, /get-started/webhooks). Voir
 * docs/PAYMENT_INTEGRATION.md pour le verdict complet
 * SUPPORTED/PARTIAL/NOT_SUPPORTED par capacité.
 */

export type NotchPayPaymentStatus =
  | "pending"
  | "processing"
  | "complete"
  | "failed"
  | "canceled"
  | "expired";

export interface NotchPayCreatePaymentPayload {
  amount: number;
  currency: string; // 'XAF' pour ce projet
  email?: string;
  phone?: string;
  description?: string;
  reference: string; // fourni par l'appelant — jamais généré par NotchPay
  callback?: string;
}

export interface NotchPayTransaction {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: NotchPayPaymentStatus;
  customer?: string;
  created_at: string;
  completed_at?: string;
}

export interface NotchPayCreatePaymentResponse {
  status: string;
  message: string;
  code: number;
  transaction: NotchPayTransaction;
  authorization_url: string;
}

export interface NotchPayRetrievePaymentResponse {
  status: string;
  message: string;
  code: number;
  transaction: NotchPayTransaction;
}

export interface NotchPayCancelPaymentResponse {
  code: number;
  status: string;
  message: string;
}

/**
 * Corps du webhook — CONFIRMÉ (un seul objet par delivery, pas de batch,
 * contrairement à Zernio où on normalise vers un tableau par prudence ;
 * ici la doc ne montre qu'un objet unique donc on ne normalise pas).
 * Events confirmés : payment.created, payment.complete, payment.failed,
 * payment.canceled, payment.expired. Aucun event "payment.refunded"
 * documenté — voir docs/PAYMENT_INTEGRATION.md, remboursement =
 * NOT_SUPPORTED via API.
 */
export interface NotchPayWebhookEvent {
  id: string;
  event:
    | "payment.created"
    | "payment.complete"
    | "payment.failed"
    | "payment.canceled"
    | "payment.expired"
    | string;
  data: {
    amount: number;
    amount_total?: number;
    sandbox?: boolean;
    fee?: number;
    converted_amount?: number;
    payment_method?: string;
    customer?: string;
    reference: string;
    provider_reference?: string | null;
    status: NotchPayPaymentStatus;
    currency: string;
    geo?: string;
    created_at: string;
    updated_at: string;
  };
}
