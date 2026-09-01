import Link from "next/link";

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-ink/5 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M12 2 2 12l10 10 10-10L12 2Zm0 3.2L18.8 12 12 18.8 5.2 12 12 5.2Z" />
            </svg>
          </span>
          <span className="font-display text-lg font-bold text-ink">Thrive</span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-ink/70 md:flex">
          <a href="/#fonctionnalites" className="hover:text-ink">
            Fonctionnalités
          </a>
          <Link href="/tarifs" className="hover:text-ink">
            Tarifs
          </Link>
          <a href="/#fonctionnalites" className="hover:text-ink">
            Ressources
          </a>
          <a href="/#avis" className="hover:text-ink">
            À propos
          </a>
        </nav>

        <div className="flex items-center gap-4">
          <Link href="/login" className="hidden text-sm font-medium text-ink/70 hover:text-ink sm:block">
            Connexion
          </Link>
          <Link
            href="/onboarding"
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            Démarrer gratuitement
          </Link>
        </div>
      </div>
    </header>
  );
}
