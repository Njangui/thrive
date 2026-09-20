"use client";

import Link from "next/link";
import type { StorefrontProduct } from "@/application/services/catalog-service";
import { trackProductClickAction } from "../track-product-click-action";
import { StorefrontImage } from "./storefront-image";
import { ProductBadges } from "./product-badges";
import { ProductPrice } from "./product-price";
import { CountdownTimer } from "./countdown-timer";

/**
 * Carte produit de la vitrine. Remplace `src/app/_components/product-card.tsx`
 * (supprimé : plus aucun import ne le référençait après ce chantier) et
 * ajoute ce qui manquait pour ressembler à une vraie boutique — badges,
 * prix barré, catégorie, état « épuisé » explicite. L'ancienne carte ne
 * montrait que nom, prix et photo.
 *
 * Reste un composant client pour la seule raison qui le justifiait déjà :
 * journaliser `product_click` sans jamais retarder la navigation.
 *
 * Un produit sans `slug` n'est PAS rendu comme un lien mort : la carte
 * s'affiche, simplement non cliquable. C'est un cas réel (produit importé
 * par CSV avant l'attribution du slug), et le faire disparaître du
 * catalogue serait pire pour le commerçant que de l'afficher sans fiche.
 */
export function ProductCard({
  product,
  organizationId,
  newBadgeLabel,
  categoryHref,
  hasVideo = false,
}: {
  product: StorefrontProduct;
  organizationId: string;
  newBadgeLabel?: string;
  /** Vidéo ACTIVE (non expirée) disponible sur la fiche — affiche un badge « ▶ Vidéo ». */
  hasVideo?: boolean;
  /** Lien vers la catégorie, quand la page appelante n'est pas déjà celle de cette catégorie. */
  categoryHref?: string | null;
}) {
  const unavailable = product.status === "out_of_stock";

  const body = (
    <article
      className={`sf-card group flex h-full flex-col overflow-hidden rounded-brand border border-black/[0.08] bg-white transition-all hover:border-brand/40 hover:shadow-md ${
        unavailable ? "opacity-75" : ""
      }`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-black/[0.03]">
        <StorefrontImage
          src={product.imageUrl}
          alt={product.name}
          className="transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <ProductBadges
          badges={product.badges}
          discountPercent={product.discountPercent}
          newLabel={newBadgeLabel}
          className="absolute left-2.5 top-2.5"
        />
        {hasVideo && (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white">
            ▶ Vidéo
          </span>
        )}
        {product.promotionEndsAt && (
          <div className="absolute right-2.5 top-2.5">
            <CountdownTimer endsAt={product.promotionEndsAt} variant="compact" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {product.categoryName && (
          <p className="text-[11px] font-medium uppercase tracking-wide text-black/45">{product.categoryName}</p>
        )}
        <h3 className="font-display text-[15px] font-semibold leading-snug line-clamp-2">{product.name}</h3>
        {product.description && <p className="line-clamp-2 text-sm text-black/55">{product.description}</p>}
        <div className="mt-auto pt-2">
          <ProductPrice unitPrice={product.unitPrice} compareAtPrice={product.compareAtPrice} />
        </div>
      </div>
    </article>
  );

  if (!product.slug) return body;

  return (
    <div className="flex h-full flex-col">
      <Link
        href={`/produits/${product.slug}`}
        className="flex h-full flex-col focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={() => {
          void trackProductClickAction(organizationId, product.id);
        }}
      >
        {body}
      </Link>
      {categoryHref && product.categoryName && (
        // Hors du `<Link>` parent : un lien imbriqué dans un lien est un
        // HTML invalide que les navigateurs corrigent de façon imprévisible.
        <Link
          href={categoryHref}
          className="mt-1.5 self-start text-[11px] font-medium text-black/45 hover:text-brand hover:underline"
        >
          Voir tout « {product.categoryName} »
        </Link>
      )}
    </div>
  );
}

/** Grille responsive partagée par la page d'accueil, le catalogue, les catégories et les promotions. */
export function ProductGrid({
  products,
  organizationId,
  newBadgeLabel,
  productIdsWithVideo,
}: {
  products: StorefrontProduct[];
  organizationId: string;
  newBadgeLabel?: string;
  /** Produits ayant une vidéo active : reçoivent le badge « ▶ Vidéo ». */
  productIdsWithVideo?: readonly string[];
}) {
  // Tableau (et non Set) : ce composant est client, ses props doivent rester sérialisables.
  const withVideo = new Set(productIdsWithVideo ?? []);
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          organizationId={organizationId}
          newBadgeLabel={newBadgeLabel}
          hasVideo={withVideo.has(product.id)}
        />
      ))}
    </div>
  );
}
