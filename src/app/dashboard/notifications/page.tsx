import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/application/services/notification-service";
import { AppError } from "@/lib/errors";

/**
 * Construit le lien vers l'entité liée à une notification, uniquement
 * quand une page de détail existe réellement dans le dashboard (section
 * "Dashboard : inbox de notifications" du cahier des charges Lot D — "si
 * related_entity_type/related_entity_id permettent de construire une
 * URL"). Pas de lien plutôt qu'un lien mort : "lead", "order" et
 * "product" n'ont pas encore de page de détail dans le périmètre livré à
 * ce lot (probablement porté par d'autres lots CRM/commandes/catalogue).
 */
function buildRelatedEntityUrl(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  if (type === "conversation") return `/dashboard/conversations/${id}`;
  return null;
}

async function markReadAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const notificationId = String(formData.get("notificationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);

  try {
    await markNotificationRead(organizationId, membership.userId, notificationId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du marquage de la notification";
    redirect(`/dashboard/notifications?error=${encodeURIComponent(message)}`);
  }
  redirect("/dashboard/notifications");
}

async function markAllReadAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);

  try {
    await markAllNotificationsRead(organizationId, membership.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du marquage des notifications";
    redirect(`/dashboard/notifications?error=${encodeURIComponent(message)}`);
  }
  redirect("/dashboard/notifications");
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  // Seuls owner/admin reçoivent des notifications (voir notifyOrgAdmins) —
  // même barrière de rôle que côté écriture.
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const notifications = await listNotifications(organizationId, membership.userId);
  const hasUnread = notifications.some((n) => !n.readAt);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight">Notifications</h1>
        {hasUnread && (
          <form action={markAllReadAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <button type="submit" className="text-sm text-leaf hover:underline">
              Tout marquer comme lu
            </button>
          </form>
        )}
      </div>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}

      {notifications.length === 0 ? (
        <p className="text-sm text-muted">Aucune notification pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {notifications.map((n) => {
            const url = buildRelatedEntityUrl(n.relatedEntityType, n.relatedEntityId);
            const isUnread = !n.readAt;
            const content = (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`text-sm ${isUnread ? "font-semibold text-ink" : "text-muted"}`}>{n.title}</p>
                  <p className="text-sm text-muted">{n.body}</p>
                  <p className="mt-1 text-xs text-muted">{new Date(n.createdAt).toLocaleString("fr-FR")}</p>
                </div>
                {isUnread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-leaf" aria-hidden="true" />}
              </div>
            );

            return (
              <div
                key={n.id}
                className={`rounded-brand border px-4 py-3 ${
                  isUnread ? "border-leaf/30 bg-leaf/5" : "border-ink/10 bg-white"
                }`}
              >
                {url ? (
                  <Link href={url} className="block">
                    {content}
                  </Link>
                ) : (
                  content
                )}
                {isUnread && (
                  <form action={markReadAction} className="mt-2">
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="notificationId" value={n.id} />
                    <button type="submit" className="text-xs text-leaf hover:underline">
                      Marquer comme lu
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
