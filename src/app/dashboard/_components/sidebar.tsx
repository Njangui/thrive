"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

interface NavLinkItem {
  type: "link";
  href: string;
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  badge?: number;
}

interface NavGroupItem {
  type: "group";
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  children: { href: string; label: string }[];
}

type NavEntry = NavLinkItem | NavGroupItem;

/**
 * Structure de navigation — reflète UNIQUEMENT des routes réelles de
 * l'app (voir `src/app/dashboard/**`). Contrairement à la maquette de
 * référence, "Catalogue" reste un lien simple (une seule page derrière
 * aujourd'hui) plutôt qu'un groupe avec des sous-pages Produits/Services/
 * Catégories/Marques qui n'existent pas encore séparément — pas de liens
 * morts. "Marketing" est le seul groupe à deux niveaux car ses deux
 * sous-pages existent réellement (voir dashboard/marketing/*).
 */
const NAV: NavEntry[] = [
  { type: "link", href: "/dashboard", label: "Vue d'ensemble", icon: "overview" },
  { type: "link", href: "/dashboard/products", label: "Catalogue", icon: "catalog" },
  { type: "link", href: "/dashboard/appointments", label: "Rendez-vous", icon: "appointments" },
  { type: "link", href: "/dashboard/conversations", label: "Conversations", icon: "conversations" },
  { type: "link", href: "/dashboard/comments", label: "Commentaires", icon: "comments" },
  { type: "link", href: "/dashboard/groups", label: "Groupes WhatsApp", icon: "clients" },
  {
    type: "group",
    label: "Marketing",
    icon: "marketing",
    children: [
      { href: "/dashboard/marketing", label: "Publications" },
      { href: "/dashboard/marketing/new", label: "Nouvelle campagne" },
    ],
  },
  { type: "link", href: "/dashboard/site", label: "Mon site", icon: "site" },
  { type: "link", href: "/dashboard/finance", label: "Finance", icon: "finance" },
  { type: "link", href: "/dashboard/subscription", label: "Mon abonnement", icon: "subscription" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  organizationName,
  aiCreditsUsed,
  aiCreditsLimit,
  userName,
  userRole,
  userEmail,
}: {
  organizationName: string;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  userName: string;
  userRole: string;
  userEmail: string;
}) {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    const activeGroup = NAV.find((e) => e.type === "group" && e.children.some((c) => isActive(pathname, c.href)));
    return activeGroup ? activeGroup.label : null;
  });

  const creditsPercent = aiCreditsLimit > 0 ? Math.min(100, Math.round((aiCreditsUsed / aiCreditsLimit) * 100)) : 0;

  return (
    <aside className="flex h-screen w-72 flex-col bg-sidebar-dark text-white/80">
      <div className="px-3 pb-3 pt-6">
        <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2.5">
          <span className="truncate font-display text-sm font-semibold text-white">{organizationName}</span>
          <Icon name="chevron" className="h-4 w-4 rotate-90 text-white/50" />
        </div>
      </div>

      <p className="mt-5 px-6 text-[11px] font-semibold uppercase tracking-wider text-white/35">Gestion</p>

      <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {NAV.map((entry) => {
          if (entry.type === "link") {
            const active = isActive(pathname, entry.href);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active ? "bg-primary text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon name={entry.icon} className="h-[18px] w-[18px] shrink-0" />
                <span className="truncate">{entry.label}</span>
                {typeof entry.badge === "number" && entry.badge > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                    {entry.badge > 99 ? "99+" : entry.badge}
                  </span>
                )}
              </Link>
            );
          }

          const groupActive = entry.children.some((c) => isActive(pathname, c.href));
          const open = openGroup === entry.label;
          return (
            <div key={entry.label}>
              <button
                type="button"
                onClick={() => setOpenGroup(open ? null : entry.label)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  groupActive ? "text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon name={entry.icon} className="h-[18px] w-[18px] shrink-0" />
                <span className="truncate">{entry.label}</span>
                <Icon name="chevron" className={`ml-auto h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
              </button>
              {open && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-white/10 pl-4">
                  {entry.children.map((child) => {
                    const active = isActive(pathname, child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                          active ? "bg-primary text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {aiCreditsLimit > 0 && (
        <div className="mx-3 mb-4 rounded-xl bg-white/5 p-3">
          <p className="text-xs font-medium text-white/70">Crédits IA</p>
          <p className="mt-0.5 text-sm font-semibold text-white">
            {aiCreditsUsed.toLocaleString("fr-FR")} / {aiCreditsLimit.toLocaleString("fr-FR")} utilisés
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-primary" style={{ width: `${creditsPercent}%` }} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/30 text-sm font-semibold text-white">
          {userName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{userName}</p>
          <p className="truncate text-xs text-white/45">{userRole}</p>
        </div>
      </div>
      <p className="truncate px-4 pb-4 text-[11px] text-white/30">{userEmail}</p>
    </aside>
  );
}
