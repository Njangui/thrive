import Link from "next/link";
import type { CatalogProductSummary } from "@/application/services/catalog-service";
import { ProductCard } from "../product-card";

export function ProductsSection({ products }: { products: CatalogProductSummary[] }) {
  if (products.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Nos produits</h2>
        <Link href="/produits" className="text-sm font-medium text-brand">
          Voir tout →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
