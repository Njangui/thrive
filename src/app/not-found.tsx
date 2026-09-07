import Link from "next/link";

/**
 * 404 racine — avant ce fichier, une route inexistante montrait l'écran
 * par défaut de Next.js (brut, sans l'identité SME-OS). Voir
 * COMPARAISON_MASTER_PROMPT.md, section "Avant toute mise en production
 * réelle". S'applique à toute route non gérée (dashboard, admin, site
 * public d'un tenant, landing marketing) — reste volontairement neutre
 * plutôt que de deviner dans quel "univers" (section 5 du master prompt)
 * l'utilisateur se trouvait.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="font-display text-2xl font-bold tracking-tight">Page introuvable</h1>
      <p className="text-sm text-muted">
        Cette page n&apos;existe pas ou plus. Vérifiez l&apos;adresse, ou revenez à l&apos;accueil.
      </p>
      <Link
        href="/"
        className="rounded-brand bg-leaf px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
