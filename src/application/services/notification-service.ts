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
 * Canaux : tous les owner/admin reçoivent l'événement persisté in-app ET
 * un push, quelle que soit la priorité.
 *
 * CORRECTIF (sept. 2026) : les événements « normal » restaient auparavant
 * in-app uniquement (« pour éviter le bruit »). Résultat pour le
 * commerçant : certaines notifications apparaissaient dans la liste sans
 * jamais sonner (publication envoyée/programmée, relance envoyée, add-on
 * activé, demande de domaine...), et il devait ouvrir la page pour les
 * découvrir. La priorité ne décide donc plus SI on notifie mais avec
 * quelle URGENCE : important/critical => urgence « high » (réveille
 * l'appareil), normal => urgence « normal » (livré, sonore, mais peut être
 * regroupé par le système). Pour re-couper le push des « normal », voir
 * `PUSH_NORMAL_PRIORITY` ci-dessous.
 */

/** Passer à `false` pour revenir à l'ancien comportement (normal = in-app seulement). */
const PUSH_NORMAL_PRIORITY = true;

export type NotificationPriority = "normal" | "important" | "critical";

export interface NotifyOrgAdminsInput {
  organizationId: string;
  title: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** Urgence du push (important/critical => « high », normal => « normal »). Toutes les priorités notifient. */
  priority?: NotificationPriority;
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
  // Lot M — pas de page de détail par publication en V1 (voir
  // app/dashboard/marketing/page.tsx, une liste), donc pas de `${id}` dans
  // l'URL : on renvoie vers la liste, où la ligne concernée est visible
  // avec son statut à jour.
  if (type === "social_post") return `/dashboard/marketing`;
  if (type === "telegram_publication") return `/dashboard/marketing`;
  if (type === "product") return `/dashboard/products`;
  if (type === "order") return `/dashboard/orders`;
  if (type === "lead") return `/dashboard/leads`;
  if (type === "domain_request") return `/dashboard/site`;
  if (type === "provider_connection") return `/dashboard/channels`;
  if (type === "organization_subscription" || type === "subscription_payment") return `/dashboard/subscription`;
  if (type === "group_broadcast") return `/dashboard/groups`;
  // Numéro WhatsApp dédié aux groupes (demande traitée, relance,
  // reprise) — toujours actionnable depuis Canaux (voir
  // phone-number-rental-service.ts et dashboard/channels/page.tsx).
  // Uniquement "phone_number" ici, PAS "subscription_payment" : ce
  // dernier type est partagé avec les notifications de paiement de
  // forfait/add-on (subscription-payment-service.ts), qui n'ont rien à
  // voir avec Canaux.
  if (type === "phone_number") return `/dashboard/channels`;
  // Lot 5 — nouveau commentaire social (temps réel, voir
  // social-post-tracking-service.ts). Pas de page de détail par
  // commentaire en V1, même logique que "social_post" ci-dessus : on
  // renvoie vers la liste, où le commentaire concerné est visible.
  if (type === "social_comment") return `/dashboard/comments`;
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
    const priority = input.priority ?? "important";
    if (priority !== "normal" || PUSH_NORMAL_PRIORITY) {
      await sendPush(input.organizationId, input.title, input.body, url ?? undefined, {
        urgency: priority === "normal" ? "normal" : "high",
      }).catch((err) => console.warn(`[notifications] échec canal push (org ${input.organizationId}):`, err));
    }

    // Le bot Telegram opérateur n'est volontairement PAS déclenché ici.
    // Cette fonction sert aux notifications internes du commerçant ; les
    // alertes de supervision flexco  passent par
    // telegram-admin-notification-service.ts avec des événements explicites.

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

export interface LatestUnreadNotification {
  id: string;
  title: string;
  body: string;
  url: string | null;
  createdAt: string;
}

/**
 * Dernière notification NON LUE du destinataire — alimente la détection
 * « nouvelle notification » du dashboard ouvert (son + toast), voir
 * app/api/notifications/unread/route.ts. Ne lève jamais.
 */
export async function getLatestUnreadNotification(
  organizationId: string,
  userId: string,
): Promise<LatestUnreadNotification | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, body, related_entity_type, related_entity_id, created_at")
    .eq("organization_id", organizationId)
    .eq("recipient_user_id", userId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn(`[notifications] échec lecture dernière non-lue (org ${organizationId}):`, error.message);
    return null;
  }
  return {
    id: data.id,
    title: data.title,
    body: data.body,
    url: buildRelatedEntityUrl(data.related_entity_type, data.related_entity_id),
    createdAt: data.created_at,
  };
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
