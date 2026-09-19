import Link from "next/link";
import type { ModuleKey } from "@/application/config/modules";
import { IconBell, IconHelp } from "@/app/_components/app-icons";
import { DashboardMobileNav } from "./mobile-nav";
import { TopbarSearch, TopbarCreateMenu } from "./topbar-actions";

/**
 * Topbar du dashboard marchand — réplique pixel par pixel d'une
 * référence fournie (sept. 2026) : recherche + création rapide + aide +
 * notifications + identité. Miroir structurel de `AdminTopbar`.
 *
 * La cloche de notification "faite main" (SVG inline + badge) qui vivait
 * jusqu'ici dans `layout.tsx` devient `IconBell` (cohérent avec le reste
 * de l'app), badge en `danger-600` — jamais de nombre inventé : `0` ->
 * aucun badge, comportement hérité de l'ancien `layout.tsx`.
 *
 * `displayName`/`initials` sont déjà résolus par `layout.tsx` (repli sur
 * l'email — voir sa note — puisqu'aucun écran de ce projet ne permet
 * aujourd'hui de renseigner un nom, `profiles.full_name` reste vide en
 * pratique).
 */
export function DashboardTopbar({
  organizationName,
  enabledModules,
  unreadCount,
  displayName,
  roleLabel,
  initials,
  industry,
  isPlatformAdmin,
}: {
  organizationName: string;
  enabledModules: ModuleKey[];
  unreadCount: number;
  displayName: string;
  roleLabel: string;
  initials: string;
  industry?: string | null;
  isPlatformAdmin?: boolean;
}) {
  return (
    <header className="flex min-w-0 items-center gap-2 border-b border-navy-900/[0.06] bg-white/80 px-4 py-3 backdrop-blur sm:px-6">
      <DashboardMobileNav organizationName={organizationName} enabledModules={enabledModules} industry={industry} isPlatformAdmin={isPlatformAdmin} />

      <TopbarSearch enabledModules={enabledModules} industry={industry} />

      <div className="ml-auto flex items-center gap-2">
        <TopbarCreateMenu enabledModules={enabledModules} />

        <Link
          href="/dashboard/notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-xl text-navy-900/60 transition hover:bg-navy-900/5 hover:text-navy-900"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} non lues)` : "Notifications"}
        >
          <IconBell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>

        <Link
          href="/dashboard/faq"
          aria-label="Aide"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-navy-900/60 transition hover:bg-navy-900/5 hover:text-navy-900"
        >
          <IconHelp className="h-5 w-5" />
        </Link>

        <div className="hidden items-center gap-2.5 border-l border-navy-900/10 pl-3 lg:flex">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 font-jakarta text-xs font-semibold text-white">
            {initials}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="max-w-[140px] truncate text-sm font-medium text-navy-900">{displayName}</span>
            <span className="text-xs adm-muted">{roleLabel}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
