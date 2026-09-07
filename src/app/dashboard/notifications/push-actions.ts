"use server";

import { requireMembership } from "@/application/services/auth-service";
import { saveSubscription, removeSubscription, sendTestPush } from "@/application/services/push-service";
import { AppError } from "@/lib/errors";

/**
 * Server Actions du toggle push (push-toggle.tsx). Même barrière de rôle
 * que le reste de la page notifications : seuls owner/admin reçoivent des
 * notifications (notifyOrgAdmins), donc seuls owner/admin peuvent activer
 * un canal pour en recevoir.
 */

export interface PushActionResult {
  ok: boolean;
  error?: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

export async function savePushSubscriptionAction(
  organizationId: string,
  subscriptionJson: string,
): Promise<PushActionResult> {
  try {
    const membership = await requireMembership(organizationId, ["owner", "admin"]);

    const parsed = JSON.parse(subscriptionJson) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!parsed.endpoint || !parsed.keys?.p256dh || !parsed.keys?.auth) {
      return { ok: false, error: "Souscription push invalide." };
    }

    await saveSubscription(organizationId, membership.userId, {
      endpoint: parsed.endpoint,
      keys: { p256dh: parsed.keys.p256dh, auth: parsed.keys.auth },
    });

    // Confirmation immédiate best-effort : si elle échoue, l'activation
    // elle-même reste un succès (la ligne est bien enregistrée) — seule la
    // preuve visuelle immédiate manquerait, sans bloquer le toggle.
    await sendTestPush(organizationId).catch(() => {});

    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Erreur lors de l'activation des notifications.") };
  }
}

export async function removePushSubscriptionAction(
  organizationId: string,
  endpoint: string,
): Promise<PushActionResult> {
  try {
    const membership = await requireMembership(organizationId, ["owner", "admin"]);
    await removeSubscription(organizationId, membership.userId, endpoint);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Erreur lors de la désactivation des notifications.") };
  }
}
