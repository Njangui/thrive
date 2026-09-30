"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { trackProductClickAction } from "../../track-product-click-action";

/**
 * Lien vers une fiche produit qui journalise `product_click` sans jamais
 * retarder la navigation (même contrat que `storefront/product-card.tsx`).
 *
 * C'est le SEUL morceau client des cartes produit de la landing : le
 * reste de la carte est rendu côté serveur. L'ancienne carte du template
 * boutique était un simple `<Link>` — les clics venus de la page d'accueil
 * n'apparaissaient donc jamais dans /dashboard/analytics/landing.
 */
export function TrackedProductLink({
  href,
  productId,
  organizationId,
  className,
  children,
}: {
  href: string;
  productId: string;
  organizationId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        void trackProductClickAction(organizationId, productId);
      }}
    >
      {children}
    </Link>
  );
}
