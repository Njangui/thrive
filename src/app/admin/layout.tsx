import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { AuthenticationError } from "@/lib/errors";

const NAV_ITEMS = [
  { href: "/admin", label: "Vue globale" },
  { href: "/admin/organizations", label: "Entreprises" },
  { href: "/admin/domains", label: "Domaines" },
  { href: "/admin/numbers", label: "Numéros" },
  { href: "/admin/channels", label: "Canaux" },
];

/**
 * Garde d'auth pour TOUTE la console `/admin/*` (03_LOT_C_super_admin.md).
 * `requirePlatformAdmin()` est rappelée individuellement dans chaque
 * page ET dans chaque Server Action mutante en aval — même pattern que
 * `/dashboard/layout.tsx` + `requireCurrentOrganization()` rappelé dans
 * chaque page dashboard (ex: `dashboard/finance/page.tsx`).
 *
 * Choix volontaire : pas de page "Accès refusé" qui confirmerait
 * l'existence de la console à un utilisateur non-admin (un membre normal
 * d'une organisation, par ex.) — `notFound()` renvoie un 404 générique,
 * comme si `/admin` n'existait pas. Seule l'absence de session redirige
 * vers `/login` (comportement normal, pas une fuite d'info). À ajuster
 * si une page "Accès refusé" explicite est préférée.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requirePlatformAdmin();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      redirect("/login");
    }
    notFound();
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-ink/10 bg-ink px-5 py-4 text-paper">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="font-display text-sm font-semibold">Console plateforme SME-OS</p>
            <p className="text-xs text-paper/60">Super admin</p>
          </div>
          <nav className="flex gap-4 text-sm">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="text-paper/70 hover:text-paper">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-5 py-8">{children}</div>
    </div>
  );
}
