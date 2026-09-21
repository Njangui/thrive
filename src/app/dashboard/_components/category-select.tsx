import Link from "next/link";
import type { CategorySummary } from "@/application/services/catalog-service";

/**
 * Remplace le `<input>` texte libre qui existait jusqu'ici sur les 4
 * formulaires produit/service (création + édition) — c'était la source
 * exacte du problème signalé ("chaussure" et "Chaussure" pourraient
 * coexister) : un marchand retapait le nom de catégorie à chaque produit
 * plutôt que de choisir dans une liste. `categories` vient de
 * `listCategories(organizationId)`, pré-remplie par secteur d'activité à
 * la création de l'entreprise (`seedDefaultCategories`).
 *
 * Le lien "Gérer les catégories" reste nécessaire : le preset par secteur
 * est un point de départ, pas une liste fermée — un marchand dont
 * l'activité déborde du preset doit pouvoir en ajouter une, mais comme
 * action explicite et séparée, jamais en la retapant au fil des produits.
 */
export function CategorySelect({
  categories,
  defaultValue,
}: {
  categories: CategorySummary[];
  defaultValue?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex items-center justify-between">
        Catégorie
        <Link href="/dashboard/products/categories" className="text-xs font-medium text-violet-600 hover:underline">
          Gérer les catégories
        </Link>
      </span>
      <select
        name="categoryId"
        defaultValue={defaultValue ?? ""}
        className="rounded-xl border border-navy-900/10 px-4 py-3 outline-hidden focus:border-violet-400"
      >
        <option value="">Aucune catégorie</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
