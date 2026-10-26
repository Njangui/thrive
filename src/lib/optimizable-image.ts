import { isProjectSupabaseHost } from "./supabase-host";

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
    // Domaine public Cloudflare R2 (C4) : injecté AU BUILD par next.config.mjs
    // (`env.NEXT_PUBLIC_R2_MEDIA_HOST`, même source que `images.remotePatterns`).
    // Sans cela, les photos R2 s'afficheraient en taille d'origine via <img>.
    const r2Host = process.env.NEXT_PUBLIC_R2_MEDIA_HOST;
    return isProjectSupabaseHost(hostname) || hostname === "picsum.photos" || (Boolean(r2Host) && hostname === r2Host);
  } catch {
    return false;
  }
}
