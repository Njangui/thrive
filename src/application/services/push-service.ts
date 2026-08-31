import webpush from "web-push";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { env } from "@/lib/env";

/**
 * push-service.ts — Lot I, Partie 1 (notifications push PWA).
 *
 * Point d'entrée unique pour tout ce qui touche aux souscriptions Web
 * Push : jamais d'appel direct à `web-push` en dehors de ce fichier (même
 * discipline que ProviderRegistry pour les fournisseurs externes, même si
 * Web Push est un standard et non un "provider" métier au sens du projet —
 * pas de table `provider_connections` nécessaire ici).
 *
 * RÈGLE ABSOLUE de ce fichier : `sendPush` ne lève JAMAIS. C'est un canal
 * best-effort appelé depuis `notification-service.ts::notifyOrgAdmins` —
 * un tenant sans VAPID configuré, sans souscription active, ou dont un
 * envoi échoue, doit continuer à recevoir ses notifications in-app
 * normalement (section 54 : "mieux vaut un comportement dégradé visible
 * qu'un crash silencieux profond" — ici c'est l'inverse qui s'applique :
 * mieux vaut un canal secondaire silencieusement absent qu'un crash du
 * canal primaire).
 */

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  createdAt: string;
}

/** Utilisé côté serveur pour décider d'afficher le toggle (voir dashboard/notifications/page.tsx). */
export function isPushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

function getConfiguredWebPushClient(): typeof webpush | null {
  if (!isPushConfigured()) return null;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  return webpush;
}

/**
 * Enregistre (ou met à jour, si le navigateur renvoie un endpoint déjà
 * connu — cas rare mais possible) une souscription. Idempotent par
 * construction : un même appareil qui se réabonne plusieurs fois écrase
 * simplement ses propres clés.
 */
export async function saveSubscription(
  organizationId: string,
  userId: string,
  subscription: PushSubscriptionInput,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      organization_id: organizationId,
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh_key: subscription.keys.p256dh,
      auth_key: subscription.keys.auth,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    throw new Error(`Impossible d'enregistrer la souscription push: ${error.message}`);
  }
}

export async function removeSubscription(organizationId: string, userId: string, endpoint: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("endpoint", endpoint);

  if (error) {
    throw new Error(`Impossible de désactiver la souscription push: ${error.message}`);
  }
}

/**
 * Utilisé pour la ré-souscription automatique (voir public/sw.js,
 * événement `pushsubscriptionchange`, et
 * src/app/api/push/resubscribe/route.ts) : retrouve la ligne existante par
 * son ancien endpoint pour la faire glisser vers les nouvelles clés, sans
 * jamais faire confiance à un `organizationId` fourni par le client.
 */
export async function rotateSubscription(
  userId: string,
  oldEndpoint: string,
  next: PushSubscriptionInput,
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data: existing, error: fetchError } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("endpoint", oldEndpoint)
    .maybeSingle();

  if (fetchError || !existing) return false;

  const { error: updateError } = await supabase
    .from("push_subscriptions")
    .update({ endpoint: next.endpoint, p256dh_key: next.keys.p256dh, auth_key: next.keys.auth })
    .eq("id", existing.id);

  return !updateError;
}

export async function listSubscriptions(organizationId: string, userId: string): Promise<PushSubscriptionRecord[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, created_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn(`[push] listSubscriptions(${organizationId}, ${userId}) erreur de lecture:`, error.message);
    return [];
  }

  return (data ?? []).map((row) => ({ id: row.id, endpoint: row.endpoint, createdAt: row.created_at }));
}

/**
 * Canal push de `notifyOrgAdmins` (notification-service.ts). Best-effort
 * total : configuration absente, aucune souscription, ou échec réseau
 * envers un endpoint particulier ne produisent jamais d'exception.
 *
 * Nettoyage automatique : une souscription qui répond 404/410 est
 * révoquée côté navigateur (désinstallation, changement de compte...) —
 * on la supprime immédiatement plutôt que de la retenter indéfiniment à
 * chaque notification future.
 */
export async function sendPush(
  organizationId: string,
  title: string,
  body: string,
  url?: string,
): Promise<void> {
  const client = getConfiguredWebPushClient();
  if (!client) return;

  try {
    const supabase = getSupabaseServiceClient();
    const { data: subscriptions, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key")
      .eq("organization_id", organizationId);

    if (error) {
      console.warn(`[push] lecture push_subscriptions échouée pour org ${organizationId}:`, error.message);
      return;
    }
    if (!subscriptions || subscriptions.length === 0) return;

    const payload = JSON.stringify({ title, body, url: url ?? "/dashboard/notifications" });

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await client.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
            payload,
          );
        } catch (sendError) {
          const statusCode = (sendError as { statusCode?: number } | null)?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          } else {
            console.warn(`[push] échec d'envoi vers une souscription (org ${organizationId}):`, sendError);
          }
        }
      }),
    );
  } catch (unexpectedError) {
    console.warn(`[push] erreur inattendue dans sendPush (org ${organizationId}):`, unexpectedError);
  }
}

/** Notification de test envoyée à l'appareil qui vient de s'abonner — voir dashboard/notifications/push-actions.ts. */
export async function sendTestPush(organizationId: string): Promise<void> {
  await sendPush(
    organizationId,
    "Notifications activées",
    "Vous recevrez désormais vos notifications même quand SME-OS est fermé.",
    "/dashboard/notifications",
  );
}
