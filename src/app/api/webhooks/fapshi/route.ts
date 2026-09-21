import type { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { handlePaymentWebhookRequest } from "@/infrastructure/providers/payment/webhook-pipeline";
import { parseFapshiWebhookPayload, verifyFapshiWebhookSecret } from "@/infrastructure/providers/payment/fapshi/webhook-handler";

/**
 * Route webhook Fapshi — délibérément fine : tout le pipeline générique
 * (rate limit, idempotence webhook_events, appel à handlePaymentWebhook,
 * réponse 200 systématique) vit dans webhook-pipeline.ts, partagé par
 * tous les providers de paiement. Voir ce fichier pour le détail, et
 * docs/PAYMENT_INTEGRATION.md ("Ajouter un nouveau provider") pour la
 * checklist complète.
 *
 * Header CONFIRMÉ (docs.fapshi.com/en/api-reference/endpoint/webhook) :
 * `x-wh-secret`, comparaison directe (pas de HMAC) — voir
 * fapshi/webhook-handler.ts.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handlePaymentWebhookRequest(request, {
    providerName: "fapshi",
    verify: (_rawBody, req) => verifyFapshiWebhookSecret(req.headers.get("x-wh-secret"), env.FAPSHI_WEBHOOK_SECRET ?? ""),
    parse: (rawBody) => {
      const event = parseFapshiWebhookPayload(rawBody);
      return {
        // Fapshi n'a pas d'identifiant d'évènement distinct de la
        // transaction elle-même (pas d'enveloppe {id, event}) — transId
        // convient comme clé d'idempotence : un transId n'atteint un
        // statut terminal (SUCCESSFUL/FAILED/EXPIRED) qu'une seule fois
        // (confirmé : "No payments can be made after status is
        // SUCCESSFUL or EXPIRED").
        externalEventId: event.transId,
        eventType: event.status,
        providerReference: event.transId,
      };
    },
  });
}
