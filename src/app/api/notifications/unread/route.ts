import { NextResponse } from "next/server";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { getCurrentUserOrganizations } from "@/application/services/auth-service";
import { getLatestUnreadNotification, getUnreadNotificationCount } from "@/application/services/notification-service";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Interrogée toutes les ~20 s par `NotificationWatcher` (dashboard ouvert)
 * pour détecter une nouvelle notification et jouer le son / afficher le
 * toast. Le push (service worker) ne couvre que les appareils où
 * l'utilisateur l'a activé ; ce canal garantit qu'un dashboard ouvert
 * sonne TOUJOURS, quelle que soit la priorité de la notification.
 *
 * Authentifiée par le cookie de session — aucune donnée d'organisation
 * n'est acceptée de l'appelant (même principe que /api/push/resubscribe).
 */
export async function GET() {
  const supabase = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  }

  const org = (await getCurrentUserOrganizations())[0];
  if (!org) {
    return NextResponse.json({ count: 0, latest: null }, { headers: NO_STORE });
  }

  const [count, latest] = await Promise.all([
    getUnreadNotificationCount(org.organizationId, user.id),
    getLatestUnreadNotification(org.organizationId, user.id),
  ]);

  return NextResponse.json({ count, latest }, { headers: NO_STORE });
}
