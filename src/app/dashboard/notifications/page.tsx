import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  buildRelatedEntityUrl,
} from "@/application/services/notification-service";
import { isPushConfigured } from "@/application/services/push-service";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { PushToggle } from "./push-toggle";

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

      {/* Lot I, Partie 1 — masqué automatiquement si VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
          ne sont pas configurées sur cet environnement (voir isPushConfigured).
          La clé publique est lue ici côté serveur et transmise en prop : elle
          n'a pas besoin d'un préfixe NEXT_PUBLIC_ (pas de duplication de
          variable d'env), ce composant serveur est le seul pont vers le
          client qui en a besoin. */}
      {isPushConfigured() && <PushToggle organizationId={organizationId} vapidPublicKey={env.VAPID_PUBLIC_KEY!} />}

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
