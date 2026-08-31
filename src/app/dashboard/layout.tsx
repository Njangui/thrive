import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getUnreadNotificationCount } from "@/application/services/notification-service";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Vue d'ensemble" },
  { href: "/dashboard/products", label: "Catalogue" },
  { href: "/dashboard/appointments", label: "Rendez-vous" },
  { href: "/dashboard/conversations", label: "Conversations" },
  { href: "/dashboard/finance", label: "Finance" },
  { href: "/dashboard/site", label: "Mon site" },
  { href: "/dashboard/subscription", label: "Mon abonnement" },
];

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
  const unreadCount = await getUnreadNotificationCount(currentOrg.organizationId, user.id);

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-ink/10 bg-white px-5 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <p className="font-display text-sm font-semibold">{currentOrg.organizationName}</p>
            <p className="text-xs text-muted capitalize">{currentOrg.role}</p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="text-muted hover:text-ink">
                {item.label}
              </Link>
            ))}
            <Link
              href="/dashboard/notifications"
              className="relative flex items-center text-muted hover:text-ink"
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
                <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-5 py-8">{children}</div>
    </div>
  );
}
