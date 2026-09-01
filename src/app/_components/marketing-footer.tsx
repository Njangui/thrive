import Link from "next/link";
import { MIcon } from "./marketing-icons";

const COLUMNS = [
  {
    title: "Produit",
    links: [
      { label: "Fonctionnalités", href: "/#fonctionnalites" },
      { label: "Canaux", href: "/#canaux" },
      { label: "Tarifs", href: "/tarifs" },
    ],
  },
  {
    title: "Ressources",
    links: [
      { label: "FAQ", href: "/#faq" },
      { label: "Comment ça marche", href: "/#comment-ca-marche" },
    ],
  },
  {
    title: "Entreprise",
    links: [
      { label: "Avis clients", href: "/#avis" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Légal",
    links: [
      { label: "Conditions d'utilisation", href: "/conditions-utilisation" },
      { label: "Politique de confidentialité", href: "/confidentialite" },
      { label: "Mentions légales", href: "/mentions-legales" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="bg-sidebar-dark text-white/60">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-6">
          <div className="col-span-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <path d="M12 2 2 12l10 10 10-10L12 2Zm0 3.2L18.8 12 12 18.8 5.2 12 12 5.2Z" />
                </svg>
              </span>
              <span className="font-display text-base font-bold text-white">Thrive</span>
            </div>
            <p className="mt-3 max-w-xs text-sm">
              La plateforme tout-en-un pour gérer, automatiser et développer votre commerce.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-sm font-semibold text-white">{col.title}</p>
              <ul className="mt-3 space-y-2 text-sm">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="hover:text-white">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs sm:flex-row">
          <p>© {new Date().getFullYear()} Thrive. Tous droits réservés.</p>
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-1.5">
              <MIcon name="shield" className="h-4 w-4" /> Sécurité
            </span>
            <span className="flex items-center gap-1.5">
              <MIcon name="globe" className="h-4 w-4" /> Hébergé en Afrique
            </span>
            <span className="flex items-center gap-1.5">
              <MIcon name="headset" className="h-4 w-4" /> Support 7j/7
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
