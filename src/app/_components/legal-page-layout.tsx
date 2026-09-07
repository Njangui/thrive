import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Mise en page partagée pour les 3 pages légales de la landing marketing
 * SME-OS (mentions légales, CGU, politique de confidentialité).
 *
 * ⚠️ Contenu de DÉPART, pas un document juridique validé — voir le
 * bandeau ci-dessous. Claude n'est pas juriste (voir les instructions du
 * produit) : je fournis une structure standard et des informations
 * factuelles pour démarrer, jamais une garantie de conformité.
 */
export function LegalPageLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-10 sm:py-16">
      <Link href="/" className="text-sm font-medium text-brand hover:underline">
        ← Retour à l&apos;accueil
      </Link>
      <div className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-ink">
        <strong>Brouillon.</strong> Cette page est un point de départ structuré, pas un document validé
        juridiquement. À faire réviser par un juriste (droit camerounais/OHADA) avant toute mise en production
        réelle — en particulier les mentions marquées <code>[À COMPLÉTER]</code>.
      </div>
      <article className="flex flex-col gap-4 text-sm leading-relaxed text-ink [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </article>
    </main>
  );
}
