import type { ProductBadge } from "@/application/services/catalog-service";

/**
 * Rendu des badges produit. Les badges sont CALCULÉS côté service
 * (`computeProductBadges`, catalog-service.ts) à partir de données
 * réelles — ce composant ne fait que les traduire. Aucune règle métier
 * ici : c'est ce qui garantit que la fiche produit, la carte produit et
 * la page promotions ne peuvent pas diverger sur ce qui mérite un badge.
 *
 * `newLabel` vient du secteur : « Nouveau » pour une boutique,
 * « Nouveauté » pour un restaurant, « Nouveau bien » pour une agence.
 */
const BADGE_STYLES: Record<ProductBadge, string> = {
  promo: "bg-clay text-white",
  new: "bg-brand text-white",
  bestseller: "bg-black/85 text-white",
  featured: "bg-[var(--brand-soft-strong,rgba(0,0,0,.08))] text-brand",
  out_of_stock: "bg-black/10 text-black/60",
};

export function ProductBadges({
  badges,
  discountPercent,
  newLabel = "Nouveau",
  className = "",
}: {
  badges: ProductBadge[];
  discountPercent?: number | null;
  newLabel?: string;
  className?: string;
}) {
  if (badges.length === 0) return null;

  const label = (badge: ProductBadge): string => {
    switch (badge) {
      case "promo":
        // La remise chiffrée n'est affichée que si elle est calculable :
        // « -0% » sur un arrondi serait pire que pas de chiffre du tout.
        return discountPercent && discountPercent > 0 ? `-${discountPercent}%` : "Promo";
      case "new":
        return newLabel;
      case "bestseller":
        return "Meilleure vente";
      case "featured":
        return "Sélection";
      case "out_of_stock":
        return "Épuisé";
      default:
        return "";
    }
  };

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {badges.map((badge) => (
        <span
          key={badge}
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${BADGE_STYLES[badge]}`}
        >
          {label(badge)}
        </span>
      ))}
    </div>
  );
}
