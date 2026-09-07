import Image from "next/image";
import Link from "next/link";
import type { PromotedProduct } from "@/application/services/landing-config-service";
import { formatPrice } from "@/lib/format";
import { isOptimizableImageUrl } from "@/lib/optimizable-image";

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
            className="flex gap-3 rounded-lg border border-brand/30 bg-white p-3 transition-colors hover:border-brand"
          >
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-ink/5">
              {product.imageUrl &&
                (isOptimizableImageUrl(product.imageUrl) ? (
                  <Image src={product.imageUrl} alt={product.name} fill sizes="80px" className="object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- photo hébergée hors de notre contrôle (mode "Lien existant"), voir isOptimizableImageUrl
                  <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                ))}
            </div>
            <div className="flex flex-1 flex-col justify-center gap-1">
              <div className="flex items-center justify-between gap-2">
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
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
