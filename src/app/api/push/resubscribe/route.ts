import { NextResponse } from "next/server";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { rotateSubscription } from "@/application/services/push-service";
import { AppError, AuthenticationError, ValidationError, toClientErrorResponse } from "@/lib/errors";

/**
 * Appelée uniquement par public/sw.js (événement `pushsubscriptionchange`),
 * jamais directement par une page. Contrairement au reste du dashboard,
 * cette route n'accepte PAS d'`organizationId` fourni par l'appelant : le
 * service worker n'a aucun moyen fiable de connaître l'organisation
 * courante (il tourne indépendamment de toute page ouverte), et faire
 * confiance à une valeur transmise par le client ouvrirait la porte à un
 * détournement d'endpoint push vers une autre organisation.
 *
 * À la place, on authentifie via le cookie de session (même mécanisme que
 * n'importe quelle page du dashboard — une requête `fetch` same-origin
 * émise depuis un service worker inclut les cookies par défaut) puis on ne
 * fait glisser QUE la ligne `push_subscriptions` déjà associée à cet
 * utilisateur et à l'ancien endpoint (voir push-service.ts::rotateSubscription).
 */
export async function POST(request: Request) {
  try {
    const sessionClient = await getSupabaseServerSessionClient();
    const {
      data: { user },
    } = await sessionClient.auth.getUser();

    if (!user) {
      throw new AuthenticationError("Session expirée — reconnectez-vous pour réactiver les notifications.");
    }

    const body = (await request.json().catch(() => null)) as {
      oldEndpoint?: string;
      subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    } | null;

    const oldEndpoint = body?.oldEndpoint;
    const nextEndpoint = body?.subscription?.endpoint;
    const p256dh = body?.subscription?.keys?.p256dh;
    const auth = body?.subscription?.keys?.auth;

    if (!oldEndpoint || !nextEndpoint || !p256dh || !auth) {
      throw new ValidationError("Payload de ré-souscription push invalide.");
    }

    const rotated = await rotateSubscription(user.id, oldEndpoint, {
      endpoint: nextEndpoint,
      keys: { p256dh, auth },
    });

    // Best-effort par nature (voir sw.js) : même si aucune ligne
    // correspondante n'existe (rotated === false), on répond 200 — la
    // prochaine notification échouera simplement contre l'ancien endpoint
    // et sera nettoyée automatiquement (sendPush, réponse 404/410).
    return NextResponse.json({ ok: true, rotated });
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("POST /api/push/resubscribe: erreur inattendue:", error);
    }
    const { status, body } = toClientErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
