import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { sendPush } from "./push-service";

/**
 * Notifications admin in-app (Lot D, section 28), étendues Lot I, Partie 1
 * avec un second canal best-effort (notifications push réelles).
 *
 * FUSION (Lot I) : le commentaire d'origine de ce fichier indiquait
 * "notifications push réelles (PWA/service worker) : hors scope V1" —
 * c'était vrai avant ce lot (aucun `push-service.ts` n'existait). Ne PAS
 * passer par le port `NotificationProvider`
 * (domain/ports/notification-provider.ts) pour autant : ce port sert aux
 * canaux de livraison externes vers le CONTACT final (email/sms/whatsapp),
 * pas aux notifications internes destinées aux admins du dashboard — la
 * distinction reste valable, `push-service.ts` est délibérément un fichier
 * séparé, pas une implémentation de ce port.
 *
 * Préférences granulaires par type de notification : toujours hors scope,
 * tout owner/admin reçoit tout (in-app ET push, sans configuration fine) —
 * seul le canal push dans son ensemble est activable/désactivable, par
 * appareil (voir dashboard/notifications/push-toggle.tsx).
 */

export interface NotifyOrgAdminsInput {
  organizationId: string;
  title: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

/**
 * Construit l'URL de destination d'une notification, uniquement quand une
 * page de détail existe réellement dans le dashboard — partagé entre
 * `notifyOrgAdmins` (payload push) et la page /dashboard/notifications
 * (lien cliquable), pour ne jamais avoir deux définitions divergentes de
 * "quelles notifications sont cliquables".
 */
export function buildRelatedEntityUrl(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  if (type === "conversation") return `/dashboard/conversations/${id}`;
  return null;
}

/**
 * Notifie tous les owner/admin de l'organisation. Insère une ligne
 * `notifications` par destinataire.
 *
 * Ne lève JAMAIS — une notification manquée (erreur DB) ne doit jamais
 * faire échouer le flux appelant (lead/commande/rupture de stock/escalade
 * doivent réussir même si ceci échoue). Erreur seulement loguée, même
 * esprit que le TODO qui existait dans handoff-service.ts avant ce lot.
 */
export async function notifyOrgAdmins(input: NotifyOrgAdminsInput): Promise<void> {
  try {
    const supabase = getSupabaseServiceClient();

    const { data: admins, error: membershipError } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("organization_id", input.organizationId)
      .in("role", ["owner", "admin"]);

    if (membershipError) {
      console.warn(
        `[notifications] impossible de lister les owner/admin de l'org ${input.organizationId}:`,
        membershipError.message,
      );
      return;
    }

    const recipients = admins ?? [];
    if (recipients.length === 0) return;

    const { error: insertError } = await supabase.from("notifications").insert(
      recipients.map((m) => ({
        organization_id: input.organizationId,
        recipient_user_id: m.user_id,
        title: input.title,
        body: input.body,
        channel: "in_app",
        related_entity_type: input.relatedEntityType ?? null,
        related_entity_id: input.relatedEntityId ?? null,
      })),
    );

    if (insertError) {
      console.warn(
        `[notifications] échec insertion notifications pour org ${input.organizationId}:`,
        insertError.message,
      );
    }

    // Canal secondaire best-effort (Lot I) : `sendPush` ne lève déjà
    // jamais par construction (voir push-service.ts), mais on garde le
    // `.catch()` explicite ici — c'est le contrat documenté par le cahier
    // Lot I ("best-effort, .catch(), jamais de throw") et une défense en
    // profondeur si cette garantie interne venait à changer un jour. On
    // l'ATTEND (plutôt qu'une promesse détachée) : en environnement
    // serverless, une promesse non attendue peut être interrompue dès que
    // la réponse est renvoyée à l'appelant — l'attendre ici est ce qui
    // garantit réellement l'envoi, sans jamais faire échouer
    // `notifyOrgAdmins` elle-même si ça tourne mal.
    const url = buildRelatedEntityUrl(input.relatedEntityType ?? null, input.relatedEntityId ?? null);
    await sendPush(input.organizationId, input.title, input.body, url ?? undefined).catch((err) =>
      console.warn(`[notifications] échec canal push (org ${input.organizationId}):`, err),
    );
  } catch (err) {
    console.warn(`[notifications] erreur inattendue notifyOrgAdmins (org ${input.organizationId}):`, err);
  }
}

/** Compteur non-lues pour le badge dashboard (section suivante — inbox). */
export async function getUnreadNotificationCount(organizationId: string, userId: string): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("recipient_user_id", userId)
    .is("read_at", null);

  if (error) {
    console.warn(
      `[notifications] échec comptage non-lues (org ${organizationId}, user ${userId}):`,
      error.message,
    );
    return 0;
  }
  return count ?? 0;
}

export interface NotificationListItem {
  id: string;
  title: string;
  body: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Liste les notifications du destinataire courant, plus récentes d'abord. */
export async function listNotifications(
  organizationId: string,
  userId: string,
  limit = 50,
): Promise<NotificationListItem[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, body, related_entity_type, related_entity_id, read_at, created_at")
    .eq("organization_id", organizationId)
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Erreur lecture notifications: ${error.message}`);

  return (data ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    relatedEntityType: n.related_entity_type,
    relatedEntityId: n.related_entity_id,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
}

/** Marque une notification comme lue — double barrière (org + destinataire). */
export async function markNotificationRead(
  organizationId: string,
  userId: string,
  notificationId: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("organization_id", organizationId)
    .eq("recipient_user_id", userId);

  if (error) {
    throw new Error(`Impossible de marquer la notification ${notificationId} comme lue: ${error.message}`);
  }
}

/** Marque toutes les notifications non-lues du destinataire courant comme lues. */
export async function markAllNotificationsRead(organizationId: string, userId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("recipient_user_id", userId)
    .is("read_at", null);

  if (error) {
    throw new Error(`Impossible de marquer les notifications comme lues: ${error.message}`);
  }
}
