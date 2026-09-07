import { IconSearch } from "./icons";
import { AdminMobileNav } from "./mobile-nav";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  support: "Support",
};

/**
 * Recherche câblée sur `/admin/organizations?q=` (mécanisme déjà présent
 * dans `admin/organizations/page.tsx`) plutôt que décorative — un
 * formulaire GET classique, aucun JS requis, cohérent avec le rendu
 * server component du reste de la console. Pas de cloche de
 * notifications ici : la référence visuelle en montre une, mais aucun
 * système de notifications admin n'existe dans ce projet — mieux vaut
 * l'omettre que simuler un badge avec un chiffre inventé.
 */
export function AdminTopbar({ role, email }: { role: string; email: string | null }) {
  const roleLabel = ROLE_LABELS[role] ?? role;
  const initial = (email ?? "A").trim().charAt(0).toUpperCase();

  return (
    <header className="flex items-center gap-3 border-b border-navy-900/[0.06] bg-white/80 px-4 py-3 backdrop-blur sm:px-6">
      <AdminMobileNav />

      <form action="/admin/organizations" method="GET" className="relative hidden max-w-sm flex-1 sm:block">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          name="q"
          placeholder="Rechercher une entreprise..."
          className="w-full rounded-xl border border-navy-900/10 bg-[#F7F6FD] py-2.5 pl-9 pr-3 text-sm text-navy-900 placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100"
        />
      </form>

      <div className="flex-1 sm:hidden" />

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-semibold leading-tight text-navy-900">{roleLabel}</p>
          {email ? <p className="max-w-[180px] truncate text-xs leading-tight adm-muted">{email}</p> : null}
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 font-jakarta text-sm font-bold text-white">
          {initial}
        </span>
      </div>
    </header>
  );
}
