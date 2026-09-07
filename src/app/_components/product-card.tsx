"use client";

import Image from "next/image";
import Link from "next/link";
import type { StorefrontProductSummary } from "@/application/services/catalog-service";
import { formatPrice } from "@/lib/format";
import { isOptimizableImageUrl } from "@/lib/optimizable-image";
import { trackProductClickAction } from "./track-product-click-action";

/**
 * `organizationId` : requis pour journaliser `product_click` (périmètre
 * hérité du Lot O — voir track-product-click-action.ts). Composant client
 * minimal (comme `tracked-cta-link.tsx`) uniquement pour ce `onClick` :
 * fire-and-forget, ne bloque jamais la navigation.
 *
 * Photo produit + `next/image` quand c'est possible (au lieu d'un `<img>`
 * brut partout) : la carte n'affichait jusqu'ici aucune image, uniquement
 * du texte — un vrai manque pour une boutique (COMPARAISON_MASTER_PROMPT.md,
 * section "conversion"). `next/image` optimise automatiquement (lazy-load,
 * redimensionnement, formats modernes) MAIS refuse tout domaine non listé
 * dans `images.remotePatterns` (next.config.mjs) — une photo produit
 * ajoutée via "Lien existant" (`ImageUploadField`) peut être hébergée
 * n'importe où. `isOptimizableImageUrl` distingue les deux cas plutôt que
 * de casser l'affichage des photos externes ou d'ouvrir `remotePatterns`
 * à n'importe quel hôte (risque d'abus/de coût, voir son commentaire).
 */
export function ProductCard({
  product,
  organizationId,
}: {
  product: StorefrontProductSummary;
  organizationId: string;
}) {
  const content = (
    <div className="flex h-full flex-col gap-2 rounded-lg border border-ink/10 bg-white transition-colors hover:border-leaf/40">
      <div className="relative aspect-square w-full overflow-hidden rounded-t-lg bg-ink/5">
        {product.imageUrl ? (
          isOptimizableImageUrl(product.imageUrl) ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              sizes="(min-width: 768px) 25vw, 50vw"
              className="object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- photo hébergée hors de notre contrôle (mode "Lien existant"), voir isOptimizableImageUrl
            <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">Pas de photo</div>
        )}
      </div>
      <div className="flex flex-col gap-2 p-4 pt-1">
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
    </div>
  );

  if (!product.slug) return content;

  return (
    <Link
      href={`/produits/${product.slug}`}
      className="block h-full"
      onClick={() => {
        void trackProductClickAction(organizationId, product.id);
      }}
    >
      {content}
    </Link>
  );
}
