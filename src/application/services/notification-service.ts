import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Notifications admin in-app (Lot D, section 28).
 *
 * Hors scope V1 (voir cahier des charges) : notifications push réelles
 * (PWA/service worker — Lot E) et préférences granulaires par type —
 * tout owner/admin reçoit tout, sans configuration. Ne PAS passer par le
 * port `NotificationProvider` (domain/ports/notification-provider.ts) :
 * ce port sert aux canaux de livraison externes (email/sms/push/whatsapp),
 * pas à l'inbox in-app du dashboard, qui est une simple table lue par les
 * admins connectés.
 */

export interface NotifyOrgAdminsInput {
  organizationId: string;
  title: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
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
