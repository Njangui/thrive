import Link from "next/link";
import { CountdownTimer } from "../../storefront/countdown-timer";
import { IconWhatsapp } from "../../storefront/storefront-icons";
import { StorefrontImage } from "../../storefront/storefront-image";
import { TrackedCtaLink } from "../../tracked-cta-link";
import type { RetailProduct } from "../model";
import { TrackedProductLink } from "./product-link";

/**
 * Carte produit de la landing boutique.
 *
 * Une seule cible cliquable principale : le NOM du produit est le lien, et
 * son `::after` s'étend sur toute la carte (« stretched link »). Un lecteur
 * d'écran entend donc un lien par produit, et le clic sur la photo marche
 * quand même. Le bouton WhatsApp est un second lien, placé AU-DESSUS de
 * ce recouvrement — jamais imbriqué dans le premier (un lien dans un lien
 * est un HTML invalide que les navigateurs corrigent de façon imprévisible).
 *
 * Tout ce qui s'affiche vient de `RetailProduct` : prix, remise, badge,
 * échéance et message WhatsApp sont décidés dans `model.ts`.
 */
export function ProductCard({ product, organizationId }: { product: RetailProduct; organizationId: string }) {
  const className = ["rt-card", product.unavailable ? "rt-card--soldout" : "", product.preview ? "rt-card--preview" : ""]
    .filter(Boolean)
    .join(" ");

  const name = product.href ? (
    product.preview ? (
      <Link href={product.href} className="rt-card__link">
        {product.name}
      </Link>
    ) : (
      <TrackedProductLink href={product.href} productId={product.id} organizationId={organizationId} className="rt-card__link">
        {product.name}
      </TrackedProductLink>
    )
  ) : (
    product.name
  );

  return (
    <article className={className}>
      <div className="rt-card__media">
        <StorefrontImage src={product.imageUrl} alt="" sizes="(min-width: 1024px) 25vw, 50vw" fallbackLabel="" />
        {product.badge && <span className={`rt-badge rt-badge--${product.badge.kind}`}>{product.badge.label}</span>}
        {product.deadline && (
          <span className="rt-card__timer">
            <CountdownTimer endsAt={product.deadline} variant="compact" />
          </span>
        )}
      </div>

      <div className="rt-card__body">
        <div className="rt-card__text">
          {product.categoryName && <p className="rt-card__cat">{product.categoryName}</p>}
          <h3 className="rt-card__name">{name}</h3>
          <p className="rt-card__price">
            <span className="rt-sr">Prix : </span>
            <ins className={product.oldPrice ? "rt-card__now rt-card__now--sale" : "rt-card__now"}>{product.price}</ins>
            {product.oldPrice && (
              <>
                <span className="rt-sr"> au lieu de </span>
                <del className="rt-card__was">{product.oldPrice}</del>
              </>
            )}
          </p>
        </div>
        {product.whatsappHref && (
          <TrackedCtaLink
            href={product.whatsappHref}
            organizationId={organizationId}
            ctaId="home_product_whatsapp"
            target="_blank"
            rel="noopener noreferrer"
            className="rt-card__wa"
          >
            <IconWhatsapp className="rt-card__wa-icon" />
            <span className="rt-sr">Commander « {product.name} » sur WhatsApp</span>
          </TrackedCtaLink>
        )}
      </div>
    </article>
  );
}
