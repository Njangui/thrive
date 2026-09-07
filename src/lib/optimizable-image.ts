/**
 * `next/image` refuse (erreur dure, pas un repli silencieux) toute URL
 * dont le domaine n'est pas explicitement listé dans
 * `next.config.mjs::images.remotePatterns`. Or les photos produit
 * peuvent venir de deux sources bien distinctes (`ImageUploadField`,
 * mode "Importer une photo" vs "Lien existant") : notre propre bucket
 * Supabase (`tenant-media`), ou n'importe quelle URL externe collée par
 * le commerçant. Utiliser `next/image` sans discernement casserait
 * l'affichage de tout produit dont la photo vient d'un lien externe —
 * une régression réelle sur une fonctionnalité existante, pas une
 * amélioration. Cette fonction distingue les deux cas pour que chaque
 * composant choisisse `<Image>` (optimisé) ou `<img>` (repli, toujours
 * fonctionnel) en conséquence.
 */
export function isOptimizableImageUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname.endsWith(".supabase.co") || hostname === "picsum.photos";
  } catch {
    return false;
  }
}
