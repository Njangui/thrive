"use client";

import Link from "next/link";
import { useState } from "react";

const LINKS = [
  { href: "#fonctionnalites", label: "Fonctionnalités" },
  { href: "#comment-ca-marche", label: "Comment ça marche" },
  { href: "#tarifs", label: "Tarifs" },
  { href: "#faq", label: "FAQ" },
];

/** Menu mobile de la landing marketing (§6/§93) — même esprit que dashboard-nav.tsx : simple, léger, jamais bloquant. */
export function MarketingMobileMenu() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? "Fermer le menu" : "Ouvrir le menu"}
        aria-expanded={isOpen}
        className="flex h-9 w-9 items-center justify-center rounded-brand text-ink hover:bg-ink/5"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5" aria-hidden="true">
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {isOpen && (
        <div className="absolute inset-x-0 top-full border-b border-ink/10 bg-white px-5 py-4 shadow-lg">
          <nav className="flex flex-col gap-3 text-sm">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setIsOpen(false)} className="text-ink/80 hover:text-ink">
                {link.label}
              </Link>
            ))}
            <Link href="/login" onClick={() => setIsOpen(false)} className="text-ink/80 hover:text-ink">
              Connexion
            </Link>
            <Link
              href="/login"
              onClick={() => setIsOpen(false)}
              className="rounded-brand bg-leaf px-4 py-2.5 text-center font-medium text-white"
            >
              Commencer gratuitement
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}
