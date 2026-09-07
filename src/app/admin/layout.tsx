import { redirect, notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { AuthenticationError } from "@/lib/errors";
import { AdminSidebar } from "./_components/sidebar";
import { AdminTopbar } from "./_components/topbar";

/**
 * Garde d'auth pour TOUTE la console `/admin/*` (03_LOT_C_super_admin.md).
 * `requirePlatformAdmin()` est rappelée individuellement dans chaque
 * page ET dans chaque Server Action mutante en aval — même pattern que
 * `/dashboard/layout.tsx` + `requireCurrentOrganization()` rappelé dans
 * chaque page dashboard (ex: `dashboard/finance/page.tsx`). L'appel ici
 * sert uniquement à afficher la coquille (sidebar + topbar) et l'identité
 * dans la topbar — ce n'est PAS ce qui protège les pages individuellement.
 *
 * Choix volontaire : pas de page "Accès refusé" qui confirmerait
 * l'existence de la console à un utilisateur non-admin (un membre normal
 * d'une organisation, par ex.) — `notFound()` renvoie un 404 générique,
 * comme si `/admin` n'existait pas. Seule l'absence de session redirige
 * vers `/login` (comportement normal, pas une fuite d'info). À ajuster
 * si une page "Accès refusé" explicite est préférée.
 *
 * Repasse design (réplique pixel par pixel d'une référence fournie,
 * sept. 2026) : coquille sidebar navy + topbar, cf. `_components/`.
 * Contenu des 9 pages inchangé — seul le chrome autour change ici.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let admin;
  try {
    admin = await requirePlatformAdmin();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      redirect("/login");
    }
    notFound();
  }

  return (
    <div className="adm-shell flex">
      <AdminSidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <AdminTopbar role={admin.role} email={admin.email} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
