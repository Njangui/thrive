import Link from "next/link";
import type { CatalogProductSummary } from "@/application/services/catalog-service";
import { formatPrice } from "@/lib/format";

export function ProductCard({ product }: { product: CatalogProductSummary }) {
  const content = (
    <div className="flex h-full flex-col gap-2 rounded-lg border border-ink/10 bg-white p-4 transition-colors hover:border-leaf/40">
      {product.categoryName && (
        <span className="text-xs uppercase tracking-wide text-muted">{product.categoryName}</span>
      )}
      <div className="receipt-row font-display text-base font-medium">
        <span>{product.name}</span>
        <span className="shrink-0 text-leaf">{formatPrice(product.unitPrice)}</span>
      </div>
      {product.description && (
        <p className="line-clamp-2 text-sm text-muted">{product.description}</p>
      )}
    </div>
  );

  if (!product.slug) return content;

  return (
    <Link href={`/produits/${product.slug}`} className="block h-full">
      {content}
    </Link>
  );
}
