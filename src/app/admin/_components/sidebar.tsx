"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconGrid,
  IconBuilding,
  IconTag,
  IconPuzzle,
  IconFlag,
  IconGlobe,
  IconPhone,
  IconPlug,
  IconCard,
  IconList,
} from "./icons";

/**
 * Sidebar de la console Super Admin — habillage visuel repris pixel par
 * pixel d'une référence fournie (sidebar navy `#0E1130`, item actif
 * violet `#5027B9`), mais avec les VRAIES sections `/admin/*` du projet
 * (03_LOT_C_super_admin.md), pas les items d'une boutique tenant
 * (Produits/Commandes/Clients) qui figuraient dans la référence — la
 * console Super Admin gère la plateforme, pas une boutique individuelle.
 *
 * "Pays" (Country Engine) ajouté au groupe Plateforme, juste après
 * Plans — pilotage des pays actifs et de leurs tarifs, prolongement
 * naturel des plans plutôt qu'une section à part.
 *
 * Regroupement en 4 blocs (reprend la logique déjà en place dans
 * `NAV_ITEMS` de l'ancien `admin/layout.tsx`, seulement réorganisée
 * visuellement) : Plateforme (ce qui définit l'offre), Infrastructure
 * (ce qui fait fonctionner les canaux tenant), Finance, Système.
 */
export const ADMIN_NAV_GROUPS: { label: string | null; items: { href: string; label: string; icon: (p: { className?: string }) => JSX.Element }[] }[] = [
  {
    label: null,
    items: [{ href: "/admin", label: "Vue globale", icon: IconGrid }],
  },
  {
    label: "Plateforme",
    items: [
      { href: "/admin/organizations", label: "Entreprises", icon: IconBuilding },
      { href: "/admin/plans", label: "Plans", icon: IconTag },
      { href: "/admin/countries", label: "Pays", icon: IconFlag },
      { href: "/admin/addons", label: "Add-ons", icon: IconPuzzle },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/admin/domains", label: "Domaines", icon: IconGlobe },
      { href: "/admin/numbers", label: "Numéros", icon: IconPhone },
      { href: "/admin/channels", label: "Canaux", icon: IconPlug },
    ],
  },
  {
    label: "Finance",
    items: [{ href: "/admin/payments", label: "Paiements", icon: IconCard }],
  },
  {
    label: "Système",
    items: [{ href: "/admin/logs", label: "Logs", icon: IconList }],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[248px] shrink-0 flex-col bg-navy-900 px-3 py-5 lg:flex">
      <Link href="/admin" className="mb-4 flex items-center gap-2.5 rounded-xl px-2 py-1.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 font-jakarta text-sm font-bold text-white">
          S
        </span>
        <span className="flex flex-col leading-tight">
          <span className="font-jakarta text-sm font-bold text-white">SME-OS</span>
          <span className="text-[11px] font-medium text-white/40">Console Super Admin</span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto pb-2">
        {ADMIN_NAV_GROUPS.map((group) => (
          <div key={group.label ?? "root"}>
            {group.label ? <p className="adm-sidebar-group-label">{group.label}</p> : null}
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => {
                const isActive = item.href === "/admin" ? pathname === "/admin" : pathname?.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={isActive ? "adm-sidebar-link-active" : "adm-sidebar-link"}>
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
