import { formatPrice } from "@/lib/format";

/**
 * Affichage d'un prix, avec prix barré quand la promotion est RÉELLE.
 * Centralisé parce que la règle « barrer seulement si compare_at_price >
 * unit_price » était réimplémentée dans trois fichiers, et qu'un
 * `compare_at_price` saisi par erreur en dessous du prix de vente y
 * produisait une remise négative affichée au client.
 *
 * `<del>`/`<ins>` plutôt que deux `<span>` : un lecteur d'écran annonce
 * alors « prix supprimé / prix actuel » au lieu de lire deux montants à
 * la suite, ce qui est ambigu pour un acheteur.
 */
export function ProductPrice({
  unitPrice,
  compareAtPrice,
  size = "md",
}: {
  unitPrice: number;
  compareAtPrice?: number | null;
  size?: "sm" | "md" | "lg";
}) {
  const hasDiscount = compareAtPrice != null && compareAtPrice > unitPrice;
  const currentClass =
    size === "lg" ? "text-2xl font-bold" : size === "sm" ? "text-sm font-semibold" : "text-base font-semibold";
  const previousClass = size === "lg" ? "text-base" : "text-xs";

  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <ins className={`font-display no-underline text-brand ${currentClass}`}>{formatPrice(unitPrice)}</ins>
      {hasDiscount && <del className={`text-black/40 ${previousClass}`}>{formatPrice(compareAtPrice)}</del>}
    </span>
  );
}
