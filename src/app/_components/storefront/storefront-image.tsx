import Image from "next/image";
import { isOptimizableImageUrl } from "@/lib/optimizable-image";

/**
 * Photo de la vitrine, avec le bon composant selon l'origine de l'URL.
 *
 * Cette bascule `next/image` vs `<img>` était dupliquée à l'identique
 * dans quatre fichiers (`product-card.tsx`, `promotions.tsx`,
 * `produits/[slug]/page.tsx`, `gallery.tsx`), à chaque fois avec son
 * propre `eslint-disable`. `next/image` refuse par une erreur dure toute
 * URL dont l'hôte n'est pas listé dans `images.remotePatterns`
 * (next.config.mjs), or une photo ajoutée en mode « Lien existant » peut
 * être hébergée n'importe où : la bascule est donc obligatoire, mais
 * elle n'a aucune raison d'exister en quatre exemplaires.
 *
 * `ratio` pose le conteneur : sans lui, une photo produit manquante
 * effondrerait la carte à zéro pixel de haut et ferait sauter toute la
 * grille au chargement.
 */
export function StorefrontImage({
  src,
  alt,
  sizes = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw",
  className = "",
  priority = false,
  fallbackLabel = "Photo à venir",
}: {
  src: string | null | undefined;
  alt: string;
  sizes?: string;
  className?: string;
  priority?: boolean;
  fallbackLabel?: string;
}) {
  if (!src) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-black/[0.04] text-xs text-black/40 ${className}`}
        aria-hidden
      >
        {fallbackLabel}
      </div>
    );
  }

  if (isOptimizableImageUrl(src)) {
    return <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className={`object-cover ${className}`} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- photo hébergée hors de notre contrôle (mode « Lien existant »), voir isOptimizableImageUrl
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={`h-full w-full object-cover ${className}`}
    />
  );
}
