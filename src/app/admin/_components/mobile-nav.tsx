"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_GROUPS } from "./sidebar";
import { IconGrid } from "./icons";

/**
 * `AdminSidebar` est masquée sous `lg` (cf. `hidden lg:flex`) — sans ce
 * composant, la console serait totalement impossible à naviguer sur
 * mobile/tablette. Réutilise `ADMIN_NAV_GROUPS` pour ne jamais avoir
 * deux listes de sections à maintenir en parallèle.
 */
export function AdminMobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

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

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <button type="button" aria-label="Fermer le menu" onClick={() => setOpen(false)} className="flex-1 bg-navy-900/40" />
          <div className="flex w-[280px] flex-col bg-navy-900 px-3 py-5">
            <div className="mb-4 flex items-center justify-between px-2">
              <Link href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 font-jakarta text-sm font-bold text-white">S</span>
                <span className="font-jakarta text-sm font-bold text-white">SME-OS Admin</span>
              </Link>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="text-white/60">
                ✕
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto pb-2">
              {ADMIN_NAV_GROUPS.map((group) => (
                <div key={group.label ?? "root"}>
                  {group.label ? <p className="adm-sidebar-group-label">{group.label}</p> : null}
                  <ul className="flex flex-col gap-1">
                    {group.items.map((item) => {
                      const isActive = item.href === "/admin" ? pathname === "/admin" : pathname?.startsWith(item.href);
                      const Icon = item.icon ?? IconGrid;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => setOpen(false)}
                            className={isActive ? "adm-sidebar-link-active" : "adm-sidebar-link"}
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
        </div>
      ) : null}
    </div>
  );
}
