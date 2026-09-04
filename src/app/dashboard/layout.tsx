import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getUnreadNotificationCount } from "@/application/services/notification-service";
import { getOnboardingStatus } from "@/application/services/onboarding-service";
import { DashboardSidebar, MobileNavDrawer } from "./_components/dashboard-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // V1 : un seul membership actif à la fois — pas de sélecteur
  // multi-entreprise (simplification volontaire, section 62 : ne pas
  // sur-engineer avant qu'un vrai besoin apparaisse). Redirige vers
  // /onboarding si aucune organisation.
  const currentOrg = await requireCurrentOrganization();

  // Lot I, Partie 2 : redirige aussi vers /onboarding si l'organisation
  // existe mais n'a jamais terminé le wizard (onboarding_completed_at
  // null) — /onboarding la reprendra à sa dernière étape persistée, jamais
  // à l'étape 1 (voir onboarding/page.tsx). Sans danger pour les
  // organisations créées avant ce lot : la migration 0025 les a
  // rétroactivement marquées "terminé" (voir son commentaire).
  const onboardingStatus = await getOnboardingStatus(currentOrg.organizationId);
  if (!onboardingStatus.completedAt) redirect("/onboarding");

  const unreadCount = await getUnreadNotificationCount(currentOrg.organizationId, user.id);

  return (
    <div className="min-h-screen bg-paper">
      {/* Lot 2 (§48-50) : barre fine toujours visible (logo + menu mobile +
          cloche) au-dessus d'une mise en page à deux colonnes — la sidebar
          desktop et le tiroir mobile partagent le même contenu de nav
          (dashboard-nav.tsx), jamais dupliqué. */}
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <MobileNavDrawer />
            <div>
              <p className="font-display text-sm font-semibold leading-tight">{currentOrg.organizationName}</p>
              <p className="text-xs capitalize leading-tight text-muted">{currentOrg.role}</p>
            </div>
          </div>
          <Link
            href="/dashboard/notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-brand text-muted hover:bg-ink/5 hover:text-ink"
            aria-label={unreadCount > 0 ? `Notifications (${unreadCount} non lues)` : "Notifications"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 17h5l-1.4-2.1a2 2 0 0 1-.35-1.13V10a6.25 6.25 0 1 0-12.5 0v3.77c0 .4-.12.79-.35 1.13L4 17h5m6 0a3 3 0 1 1-6 0m6 0H9"
              />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 text-[10px] font-semibold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl">
        <DashboardSidebar />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
