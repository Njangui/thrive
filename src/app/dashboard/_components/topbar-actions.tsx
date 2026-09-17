"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useVisibleNavGroups } from "./dashboard-nav";
import { IconSearch, IconTag, IconBriefcase, IconClock, IconBanknote } from "@/app/_components/app-icons";
import type { ModuleKey } from "@/application/config/modules";

/**
 * Recherche + création rapide de la topbar — réplique pixel par pixel
 * d'une référence fournie (sept. 2026). Portée VOLONTAIREMENT limitée à
 * ce qui existe réellement :
 *  - la recherche est un sélecteur rapide de navigation (filtre les 17
 *    destinations du menu), PAS une recherche plein-texte dans les
 *    produits/commandes/clients — ce second projet demanderait un
 *    véritable index de recherche cross-entités, hors périmètre de ce
 *    chantier de design. Mieux vaut une recherche de nav honnête qu'une
 *    barre de recherche qui a l'air de tout chercher et ne cherche rien.
 *  - "+" ne propose QUE les créations qui ont un vrai point d'entrée
 *    dans l'app aujourd'hui (produit, service, rendez-vous, écriture
 *    finance) — pas de lien vers une page de création qui n'existe pas
 *    (leads/commandes n'ont pas de formulaire de création dédié, voir le
 *    raisonnement dans la conversation).
 */

function useNavItems(enabledModules: ModuleKey[], industry?: string | null) {
  const groups = useVisibleNavGroups(enabledModules, industry);
  return useMemo(() => groups.flatMap((g) => g.items), [groups]);
}

export function TopbarSearch({ enabledModules, industry }: { enabledModules: ModuleKey[]; industry?: string | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const items = useNavItems(enabledModules, industry);

  const results = query.trim()
    ? items.filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase()))
    : items.slice(0, 6);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  // Même bug/correctif que `DashboardMobileNav` (voir sa note) : ce
  // composant est rendu dans le `<header backdrop-blur>` de
  // `DashboardTopbar`, donc sa modale `fixed inset-0` s'y retrouvait
  // confinée au lieu de couvrir l'écran — portail vers `document.body`.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div className="relative min-w-0 flex-1 max-w-sm">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex w-full items-center gap-2 rounded-xl border border-navy-900/10 bg-white px-3 py-2 text-left text-sm text-navy-900/40 transition hover:border-navy-900/20"
      >
        <IconSearch className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">Rechercher une section...</span>
        <span className="hidden shrink-0 rounded-md border border-navy-900/10 px-1.5 py-0.5 text-[10px] font-medium sm:inline">
          Ctrl+K
        </span>
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy-900/40 px-4 pt-24" onClick={() => setOpen(false)}>
              <div className="w-full max-w-md rounded-2xl bg-white p-2 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 border-b border-navy-900/[0.06] px-3 py-2.5">
                  <IconSearch className="h-4 w-4 shrink-0 text-navy-900/40" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Rechercher une section..."
                    className="w-full text-sm outline-none placeholder:text-navy-900/40"
                  />
                </div>
                <ul className="max-h-72 overflow-y-auto p-1">
                  {results.length === 0 ? (
                    <li className="px-3 py-6 text-center text-sm adm-muted">Aucune section correspondante.</li>
                  ) : (
                    results.map((item) => {
                      const Icon = item.icon;
                      return (
                        <li key={item.href}>
                          <button
                            type="button"
                            onClick={() => go(item.href)}
                            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-navy-900 transition hover:bg-violet-50"
                          >
                            <Icon className="h-4 w-4 shrink-0 text-navy-900/50" />
                            {item.label}
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const CREATE_LINKS = [
  { href: "/dashboard/products/new", label: "Nouveau produit", icon: IconTag, module: "catalog" as ModuleKey },
  { href: "/dashboard/services/new", label: "Nouvelle prestation", icon: IconBriefcase, module: "catalog" as ModuleKey },
  { href: "/dashboard/appointments", label: "Nouveau rendez-vous", icon: IconClock, module: "appointments" as ModuleKey },
  { href: "/dashboard/finance", label: "Écriture finance", icon: IconBanknote, module: "finance" as ModuleKey },
];

export function TopbarCreateMenu({ enabledModules }: { enabledModules: ModuleKey[] }) {
  const [open, setOpen] = useState(false);

  const links = CREATE_LINKS.filter(item => enabledModules.includes(item.module));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Créer"
        className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white transition hover:bg-violet-700"
      >
        <span className="text-lg leading-none">+</span>
      </button>
      {open ? (
        <>
          {/* Même bug/correctif de containing block que TopbarSearch : ce
              gobe-clic doit couvrir tout l'écran pour fermer le menu au
              clic extérieur, donc il doit lui aussi être sorti du
              `<header backdrop-blur>` via un portail. */}
          {createPortal(
            <button type="button" aria-label="Fermer" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />,
            document.body,
          )}
          <ul className="absolute right-0 z-50 mt-2 w-52 rounded-xl border border-navy-900/[0.06] bg-white p-1.5 shadow-lg">
            {links.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-navy-900 transition hover:bg-violet-50"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-navy-900/50" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
