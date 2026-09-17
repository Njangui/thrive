import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Mise en page partagée pour les 3 pages légales de la landing marketing
 * CRESYVA (mentions légales, CGU, politique de confidentialité).
 *
 * ⚠️ Contenu de DÉPART, pas un document juridique validé — voir le
 * bandeau ci-dessous. Claude n'est pas juriste (voir les instructions du
 * produit) : je fournis une structure standard et des informations
 * factuelles pour démarrer, jamais une garantie de conformité.
 *
 * Habillage repris en violet/navy (chantier d'unification design, sept.
 * 2026) : ces pages appartiennent à la landing marketing CRESYVA (lien
 * retour "Accueil", liées depuis son footer), pas au thème de la vitrine
 * tenant qu'elles utilisaient jusqu'ici par erreur d'héritage. Le bandeau
 * "Brouillon" passe de `clay` (erreur) à `warning` (amber) : c'est un
 * avertissement de statut juridique, pas un message d'échec.
 */
export function LegalPageLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="adm-shell mx-auto flex max-w-2xl flex-col gap-6 px-5 py-10 sm:py-16">
      <Link href="/" className="text-sm font-medium text-violet-600 hover:underline">
        ← Retour à l&apos;accueil
      </Link>
      <div className="adm-alert-warning">
        <strong>Brouillon.</strong> Cette page est un point de départ structuré, pas un document validé
        juridiquement. À faire réviser par un juriste (droit camerounais/OHADA) avant toute mise en production
        réelle — en particulier les mentions marquées <code>[À COMPLÉTER]</code>.
      </div>
      <article className="flex flex-col gap-4 text-sm leading-relaxed text-navy-900 [&_h2]:mt-4 [&_h2]:font-jakarta [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1">
        <h1 className="font-jakarta text-2xl font-bold tracking-tight text-navy-900">{title}</h1>
        {children}
      </article>
    </main>
  );
}
