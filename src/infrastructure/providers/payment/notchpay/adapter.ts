import type {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentProvider,
  PaymentStatusResult,
} from "@/domain/ports/payment-provider";
import type { NotchPayPaymentStatus } from "./types";
import { NotchPayClient } from "./client";

/**
 * Mapping de statut CONFIRMÉ -> port générique. NotchPay a 6 statuts, le
 * port n'en a que 4 : `processing` -> `pending` (le paiement n'est pas
 * encore définitivement acquis, section "Bonnes pratiques" — toujours
 * revérifier avant de livrer) ; `canceled`/`expired` -> `failed` (le
 * port ne distingue pas "jamais tenté" de "annulé/expiré" — l'info brute
 * reste disponible dans `rawPayload` pour qui en a besoin). Aucun statut
 * NotchPay ne mappe vers `refunded` : aucun event webhook ni valeur de
 * `status` "refunded" n'est documenté côté NotchPay (remboursement =
 * dashboard uniquement, voir docs/PAYMENT_INTEGRATION.md) — ce cas ne se
 * produira donc jamais en pratique via cet adapter.
 */
function mapStatus(status: NotchPayPaymentStatus): PaymentStatusResult["status"] {
  switch (status) {
    case "complete":
      return "succeeded";
    case "pending":
    case "processing":
      return "pending";
    case "failed":
    case "canceled":
    case "expired":
      return "failed";
  }
}

export class NotchPayAdapter implements PaymentProvider {
  readonly providerName = "notchpay";

  constructor(private readonly client: NotchPayClient) {}

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    if (!request.customerEmail && !request.customerPhone) {
      // CONFIRMÉ : NotchPay exige email OU phone OU customer.
      // subscription-payment-service.ts transmet toujours l'email de
      // session de l'acteur (toujours disponible via Supabase Auth,
      // contrairement à un numéro de téléphone) — ce garde-fou protège
      // tout futur appelant qui oublierait les deux.
      throw new Error("NotchPay: customerEmail ou customerPhone doit être fourni pour créer un paiement.");
    }

    // `orderId` du port générique porte ici l'id de la ligne
    // `subscription_payments` (UUID généré côté application AVANT cet
    // appel — voir subscription-payment-service.ts) : le nom du champ
    // vient d'un port pensé à l'origine pour des commandes produit, mais
    // sa sémantique ("la référence de ce qui est payé") s'applique
    // identiquement à un paiement d'abonnement ou d'add-on. Documenté ici
    // plutôt que de renommer un champ de port partagé sans certitude sur
    // qui d'autre pourrait déjà en dépendre.
    const response = await this.client.createPayment({
      amount: request.amount,
      currency: request.currency,
      email: request.customerEmail,
      phone: request.customerPhone,
      description: request.description,
      reference: request.orderId,
      callback: undefined,
    });

    return {
      providerReference: response.transaction.reference,
      paymentUrl: response.authorization_url,
      status: mapStatus(response.transaction.status) === "succeeded" ? "succeeded" : "pending",
    };
  }

  async verifyPayment(providerReference: string): Promise<PaymentStatusResult> {
    const response = await this.client.retrievePayment(providerReference);
    return {
      providerReference: response.transaction.reference,
      status: mapStatus(response.transaction.status),
      rawPayload: response.transaction as unknown as Record<string, unknown>,
    };
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentStatusResult> {
    // CONFIRMÉ : un seul endpoint de lecture côté NotchPay
    // (GET /payments/{reference}) — verifyPayment et getPaymentStatus
    // sont donc rigoureusement équivalents pour cet adapter. Les deux
    // méthodes existent séparément dans le port (probablement pensées
    // pour un provider où "vérifier après paiement" et "lire le statut
    // actuel" diffèrent) ; on documente ici plutôt que de dupliquer le
    // code.
    return this.verifyPayment(providerReference);
  }

  async cancelPayment(providerReference: string): Promise<void> {
    await this.client.cancelPayment(providerReference);
  }
}
