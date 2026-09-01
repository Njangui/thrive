import Link from "next/link";
import { Icon } from "./icons";
import { ProfileMenu } from "./profile-menu";

export function Topbar({
  unreadCount,
  userName,
  userRole,
}: {
  unreadCount: number;
  userName: string;
  userRole: string;
}) {
  return (
    <header className="flex items-center justify-between border-b border-ink/10 bg-white px-6 py-3">
      {/* Recherche : chrome visuel pour l'instant, aucune fonction de recherche
          globale n'existe côté backend — un champ qui ne ferait rien de réel
          au clic serait trompeur, donc il reste un simple champ texte inerte. */}
      <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-paper/60 px-3 py-2 text-sm text-muted sm:w-72">
        <Icon name="search" className="h-4 w-4 shrink-0" />
        <span className="truncate">Rechercher quelque chose...</span>
      </div>

      <div className="flex items-center gap-1.5">
        <Link
          href="/dashboard/notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-ink/5 hover:text-ink"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} non lues)` : "Notifications"}
        >
          <Icon name="bell" className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>
        <div className="mx-1 h-6 w-px bg-ink/10" />
        <ProfileMenu userName={userName} userRole={userRole} />
      </div>
    </header>
  );
}
