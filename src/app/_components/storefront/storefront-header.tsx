"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { StorefrontNavEntry } from "@/application/services/storefront-service";
import { IconClose, IconMenu, IconSearch, IconWhatsapp } from "./storefront-icons";
import { Container } from "./storefront-ui";

/**
 * En-tête de la vitrine. Composant client pour trois raisons précises,
 * toutes impossibles à obtenir côté serveur :
 *  - l'ouverture/fermeture du menu mobile ;
 *  - la fermeture automatique de ce menu à chaque changement de route
 *    (sans ça, le menu reste ouvert par-dessus la page d'arrivée) ;
 *  - le marquage de l'entrée active à partir du chemin courant.
 *
 * Tout le reste (résolution du tenant, capacités, navigation) est calculé
 * côté serveur et transmis en props sérialisables : aucune requête n'est
 * faite depuis le navigateur.
 */
export function StorefrontHeader({
  businessName,
  logoUrl,
  nav,
  whatsappHref,
  searchEnabled,
  catalogHref,
  ctaLabel,
  homeOverlay = false,
}: {
  businessName: string;
  logoUrl: string | null;
  nav: StorefrontNavEntry[];
  whatsappHref: string | null;
  searchEnabled: boolean;
  catalogHref: string;
  ctaLabel: string;
  homeOverlay?: boolean;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Ferme le menu mobile à chaque navigation : état ajusté PENDANT le rendu (pattern React
  // « ajuster l'état quand une prop change »), sans effet ni rendu intermédiaire.
  const [menuPathname, setMenuPathname] = useState(pathname);
  if (menuPathname !== pathname) {
    setMenuPathname(pathname);
    setMenuOpen(false);
  }

  // Le menu mobile est en `position: fixed` : sans ce verrou, le corps de
  // la page continue de défiler derrière lui sur iOS.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className={`sf-header ${homeOverlay ? "sf-header-overlay" : "sticky top-0"} z-40 border-b border-black/[0.07] bg-white/95 backdrop-blur-sm`}>
      <Container className="flex h-16 items-center gap-3 sm:h-[72px] sm:gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`${businessName} — accueil`}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo pouvant être hébergé hors de nos domaines autorisés (voir isOptimizableImageUrl)
            <img src={logoUrl} alt={businessName} className="h-9 w-auto max-w-[160px] object-contain" />
          ) : (
            <span className="font-display text-lg font-extrabold tracking-tight">{businessName}</span>
          )}
        </Link>

        <nav aria-label="Navigation principale" className="hidden flex-1 items-center gap-1 lg:flex">
          {nav.map((entry) => (
            <Link
              key={entry.key}
              href={entry.href}
              aria-current={isActive(entry.href) ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive(entry.href) ? "text-brand" : "text-black/70 hover:text-brand"
              }`}
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {searchEnabled && (
            // Formulaire GET natif : la recherche reste une URL partageable
            // et indexable (/produits?q=...), et fonctionne sans JavaScript.
            <form action={catalogHref} method="get" role="search" className="hidden items-center sm:flex">
              <label htmlFor="sf-search" className="sr-only">
                Rechercher
              </label>
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
                <input
                  id="sf-search"
                  type="search"
                  name="q"
                  placeholder="Rechercher…"
                  className="h-10 w-40 rounded-brand border border-black/10 bg-white pl-8 pr-3 text-sm outline-hidden transition-[width] focus:w-56 focus:border-brand"
                />
              </div>
            </form>
          )}

          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="sf-btn-primary hidden h-10 items-center gap-2 px-4 text-sm sm:inline-flex"
            >
              <IconWhatsapp className="h-4 w-4" />
              {ctaLabel}
            </a>
          )}

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="sf-mobile-menu"
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-brand border border-black/10 lg:hidden"
          >
            {menuOpen ? <IconClose className="h-5 w-5" /> : <IconMenu className="h-5 w-5" />}
          </button>
        </div>
      </Container>

      {menuOpen && (
        <div id="sf-mobile-menu" className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-white lg:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {searchEnabled && (
              <form action={catalogHref} method="get" role="search" className="mb-3">
                <label htmlFor="sf-search-mobile" className="sr-only">
                  Rechercher
                </label>
                <input
                  id="sf-search-mobile"
                  type="search"
                  name="q"
                  placeholder="Rechercher…"
                  className="h-11 w-full rounded-brand border border-black/10 px-3 text-sm outline-hidden focus:border-brand"
                />
              </form>
            )}
            {nav.map((entry) => (
              <Link
                key={entry.key}
                href={entry.href}
                aria-current={isActive(entry.href) ? "page" : undefined}
                className={`rounded-brand px-3 py-3 text-base font-medium ${
                  isActive(entry.href) ? "bg-[var(--brand-soft,rgba(0,0,0,.04))] text-brand" : "text-black/80"
                }`}
              >
                {entry.label}
              </Link>
            ))}
            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="sf-btn-primary mt-3 inline-flex h-12 items-center justify-center gap-2 text-sm"
              >
                <IconWhatsapp className="h-4 w-4" />
                {ctaLabel}
              </a>
            )}
          </Container>
        </div>
      )}
    </header>
  );
}
