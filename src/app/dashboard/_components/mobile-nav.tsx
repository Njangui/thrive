"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CresyvaBrand } from "@/app/_components/cresyva-brand";
import type { ModuleKey } from "@/application/config/modules";
import { isActive, useVisibleNavGroups } from "./dashboard-nav";

/**
 * `DashboardSidebar` est masquée sous `lg` (`hidden lg:flex`) — sans ce
 * composant, le dashboard serait impossible à naviguer sur mobile, alors
 * que la majorité des commerçants cibles de CRESYVA l'utilisent
 * probablement depuis leur téléphone. Miroir de `AdminMobileNav`.
 *
 * Filtrée par `enabledModules` comme `DashboardSidebar` (même
 * `useVisibleNavGroups`, sept. 2026) — sinon la nav mobile contredirait
 * la nav desktop pour un même compte.
 *
 * Bug mobile réel corrigé (sept. 2026) : ce tiroir est rendu à l'intérieur
 * du `<header>` de `DashboardTopbar`, qui porte `backdrop-blur`. Or
 * `backdrop-filter` (comme `filter`/`transform`/`will-change`) crée un
 * nouveau "containing block" CSS pour tout descendant `position: fixed`
 * — le tiroir (`fixed inset-0`) se retrouvait donc confiné à la hauteur
 * du bandeau du haut au lieu de couvrir tout l'écran, d'où le rendu
 * cassé (tiroir écrasé en haut, contenu de la page visible juste en
 * dessous, sans recouvrement réel). Corrigé en sortant ce bloc du DOM du
 * `<header>` via un portail React direct vers `document.body`, la seule
 * façon fiable d'échapper au containing block d'un ancêtre quel qu'il
 * soit. Le blocage du scroll de la page pendant l'ouverture (absent
 * avant) est ajouté au passage : sans lui, la page défilait librement
 * derrière un tiroir censé être modal.
 */
export function DashboardMobileNav({
  organizationName,
  enabledModules,
  industry,
}: {
  organizationName: string;
  enabledModules: ModuleKey[];
  industry?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const groups = useVisibleNavGroups(enabledModules, industry);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ouvrir le menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-navy-900/10 text-navy-900"
      >
        <span className="block h-[1.5px] w-4 bg-current before:absolute before:-mt-1.5 before:block before:h-[1.5px] before:w-4 before:bg-current after:absolute after:mt-1.5 after:block after:h-[1.5px] after:w-4 after:bg-current" />
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex h-dvh">
              <button type="button" aria-label="Fermer le menu" onClick={() => setOpen(false)} className="flex-1 bg-navy-900/40" />
              <div className="flex h-full w-[280px] flex-col overflow-y-auto bg-navy-900 px-3 py-5">
                <div className="mb-4 flex items-center justify-between px-2">
                  <div onClick={() => setOpen(false)}>
                    <CresyvaBrand href="/dashboard" compact dark />
                    <p className="mt-2 max-w-[180px] truncate text-[11px] font-medium text-white/40">{organizationName}</p>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="text-white/60">
                    ✕
                  </button>
                </div>
                <nav className="flex-1 pb-2">
                  {groups.map((group) => (
                    <div key={group.label ?? "root"}>
                      {group.label ? <p className="adm-sidebar-group-label">{group.label}</p> : null}
                      <ul className="flex flex-col gap-1">
                        {group.items.map((item) => {
                          const active = isActive(pathname, item.href);
                          const Icon = item.icon;
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                onClick={() => setOpen(false)}
                                className={active ? "adm-sidebar-link-active" : "adm-sidebar-link"}
                              >
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
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
