import type {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentProvider,
  PaymentStatusResult,
} from "@/domain/ports/payment-provider";
import type { FapshiClient } from "./client";
import type { FapshiTransactionStatus } from "./types";

function mapStatus(status: FapshiTransactionStatus): PaymentStatusResult["status"] {
  switch (status) {
    case "SUCCESSFUL":
      return "succeeded";
    case "CREATED":
    case "PENDING":
      return "pending";
    case "FAILED":
    case "EXPIRED":
      return "failed";
  }
}

/**
 * Adapter Fapshi — seule implémentation concrète du port PaymentProvider
 * dans ce fichier à connaître le SDK/vocabulaire Fapshi. Rien en dehors
 * de ce dossier (`payment/fapshi/`) et de `registry.ts` ne doit jamais
 * importer quoi que ce soit d'ici — c'est précisément ce qui permettra au
 * prochain changement de provider de ne toucher QUE ce dossier + un cas
 * dans registry.ts + les variables d'env, jamais les services applicatifs
 * (subscription-payment-service.ts, addons-service.ts,
 * phone-number-rental-service.ts).
 *
 * Contrainte réelle et durable à connaître avant d'étendre ce provider :
 * Fapshi ne traite QUE le XAF (Cameroun, MTN MoMo/Orange Money) — pas de
 * couverture multi-pays comme NotchPay le revendiquait. Voir le
 * commentaire de `getPaymentProvider()` dans registry.ts pour l'impact
 * sur le Country Engine (NG/GH/CI/SN/GA/KE/UG).
 */
export class FapshiAdapter implements PaymentProvider {
  readonly providerName = "fapshi";

  constructor(private readonly client: FapshiClient) {}

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    if (request.currency !== "XAF") {
      throw new Error(
        `Fapshi ne traite que le XAF (Cameroun) — devise reçue: "${request.currency}". ` +
          "Ce pays n'est pas payable via ce provider (voir Country Engine).",
      );
    }
    if (request.amount < 100) {
      throw new Error("Fapshi: le montant minimum accepté est 100 XAF.");
    }

    // Pas de mapping customerPhone ici : `initiate-pay` (page hébergée)
    // n'accepte pas de téléphone en paramètre côté Fapshi — seul
    // `direct-pay` (push USSD direct, désactivé par défaut en live et
    // jamais utilisé dans ce projet : tous les appelants passent
    // toujours customerEmail, jamais customerPhone, confirmé dans
    // subscription-payment-service.ts/addons-service.ts/
    // phone-number-rental-service.ts) accepte un phone.
    const response = await this.client.initiatePay({
      amount: request.amount,
      email: request.customerEmail,
      externalId: request.orderId,
      userId: request.organizationId,
      message: request.description,
    });

    return {
      // La référence provider n'est connue qu'ICI, après coup — jamais
      // égale à request.orderId. Voir le commentaire en tête de types.ts.
      providerReference: response.transId,
      paymentUrl: response.link,
      status: "pending",
    };
  }

  async verifyPayment(providerReference: string): Promise<PaymentStatusResult> {
    const transaction = await this.client.paymentStatus(providerReference);
    return {
      providerReference: transaction.transId,
      status: mapStatus(transaction.status),
      rawPayload: transaction as unknown as Record<string, unknown>,
    };
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentStatusResult> {
    // Un seul endpoint de lecture côté Fapshi pour les deux usages (même
    // équivalence que documentée précédemment pour NotchPay).
    return this.verifyPayment(providerReference);
  }

  async cancelPayment(providerReference: string): Promise<void> {
    await this.client.expirePay(providerReference);
  }
}
