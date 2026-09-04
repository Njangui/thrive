import Link from "next/link";
import type { PromotedProduct } from "@/application/services/landing-config-service";
import { formatPrice } from "@/lib/format";

export function PromotionsSection({ products }: { products: PromotedProduct[] }) {
  if (products.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold">Promotions en cours</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {products.map((product) => (
          <Link
            key={product.id}
            href={product.slug ? `/produits/${product.slug}` : "/produits"}
            className="flex flex-col gap-2 rounded-lg border border-brand/30 bg-white p-4 transition-colors hover:border-brand"
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-base font-medium">{product.name}</span>
              <span className="shrink-0 rounded-full bg-clay/10 px-2 py-0.5 text-xs font-medium text-clay">
                Promo
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-base font-semibold text-brand">
                {formatPrice(product.unitPrice)}
              </span>
              <span className="text-sm text-muted line-through">{formatPrice(product.compareAtPrice)}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
