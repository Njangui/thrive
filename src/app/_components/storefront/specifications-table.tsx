import type { CatalogSpecification } from "@/domain/entities/catalog";

/**
 * "Informations complémentaires" — catalogue V2 (0056), partagé par la
 * fiche produit (`produits/[slug]/page.tsx`) et la fiche prestation
 * (`services/[slug]/page.tsx`) : même rendu pour les deux, une seule
 * fois plutôt que dupliqué (section 100 : pas de logique dupliquée,
 * même discipline que `resolvePrimaryImageUrl` réutilisé par
 * service-service.ts).
 *
 * Jamais un tableau vide affiché : un produit/service sans information
 * configurée ne montre aucun titre de section ni bloc vide.
 */
export function SpecificationsTable({ specifications }: { specifications: CatalogSpecification[] }) {
  if (specifications.length === 0) return null;

  return (
    <div className="mt-10 border-t border-black/[0.07] pt-8">
      <h2 className="font-display text-base font-bold tracking-tight">Informations complémentaires</h2>
      <dl className="mt-3 max-w-2xl divide-y divide-black/[0.06] text-sm">
        {specifications.map((spec, index) => (
          <div key={`${spec.label}-${index}`} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-black/55">{spec.label}</dt>
            <dd className="text-right font-medium text-black/80">{spec.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
