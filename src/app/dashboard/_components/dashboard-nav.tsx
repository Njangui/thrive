"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Lot 2 (master prompt §48-50/93) — remplace l'ancienne nav plate (15
 * liens horizontaux dans le header, aucune adaptation mobile) par une
 * sidebar groupée sur desktop et un tiroir (drawer) sur mobile. Un seul
 * composant client (pas deux qui se partageraient un état d'ouverture)
 * pour garder ça simple — la liste des liens elle-même reste une donnée
 * statique, aucun besoin de la faire remonter du serveur.
 */

interface NavGroup {
  label: string;
  items: { href: string; label: string }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Ventes",
    items: [
      { href: "/dashboard/products", label: "Catalogue" },
      { href: "/dashboard/services", label: "Services" },
      { href: "/dashboard/orders", label: "Commandes" },
      { href: "/dashboard/leads", label: "Clients" },
      { href: "/dashboard/appointments", label: "Rendez-vous" },
    ],
  },
  {
    label: "Communication",
    items: [
      { href: "/dashboard/conversations", label: "Conversations" },
      { href: "/dashboard/groups", label: "Groupes WhatsApp" },
      { href: "/dashboard/comments", label: "Commentaires" },
    ],
  },
  {
    label: "Marketing",
    items: [{ href: "/dashboard/marketing", label: "Publications" }],
  },
  {
    label: "Mon entreprise",
    items: [
      { href: "/dashboard/site", label: "Mon site" },
      { href: "/dashboard/ai", label: "Assistant IA" },
      { href: "/dashboard/finance", label: "Finance" },
    ],
  },
  {
    label: "Système",
    items: [
      { href: "/dashboard/team", label: "Équipe" },
      { href: "/dashboard/subscription", label: "Mon abonnement" },
      { href: "/dashboard/addons", label: "Add-ons" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
}

function NavLink({ href, label, onNavigate }: { href: string; label: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`block rounded-brand px-3 py-2 text-sm transition-colors ${
        active ? "bg-leaf/10 font-medium text-leaf" : "text-ink/80 hover:bg-ink/5 hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5">
      <NavLink href="/dashboard" label="Vue d'ensemble" onNavigate={onNavigate} />
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</p>
          <div className="mt-1 flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function DashboardSidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-ink/10 bg-white px-3 py-6 md:block">
      <NavContent />
    </aside>
  );
}

export function MobileNavDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  // Ferme automatiquement le tiroir après un changement de page (ex:
  // navigation par le bouton retour) — évite un tiroir resté ouvert par
  // erreur au-dessus du nouveau contenu.
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Ouvrir le menu"
        aria-expanded={isOpen}
        className="flex h-9 w-9 items-center justify-center rounded-brand text-ink hover:bg-ink/5"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div className="fixed inset-0 bg-ink/40" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div className="relative flex h-full w-72 max-w-[80vw] flex-col overflow-y-auto bg-white px-3 py-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between px-3">
              <span className="font-display text-sm font-semibold">Menu</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Fermer le menu"
                className="flex h-8 w-8 items-center justify-center rounded-brand text-muted hover:bg-ink/5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <NavContent onNavigate={() => setIsOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
