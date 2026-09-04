import Link from "next/link";
import type { CategorySummary } from "@/application/services/landing-config-service";

export function CategoriesSection({ categories }: { categories: CategorySummary[] }) {
  if (categories.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold">Nos catégories</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {categories.map((category) => (
          <Link
            key={category.id}
            href={`/produits?category=${encodeURIComponent(category.slug)}`}
            className="flex flex-col gap-1 rounded-lg border border-ink/10 bg-white p-4 transition-colors hover:border-brand/40"
          >
            <span className="font-display text-sm font-medium">{category.name}</span>
            <span className="text-xs text-muted">
              {category.productCount} produit{category.productCount > 1 ? "s" : ""}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
