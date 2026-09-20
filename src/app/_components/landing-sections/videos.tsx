import type { CatalogVideo } from "@/application/services/catalog-video-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { StorefrontVideo } from "../storefront/storefront-video";
import { Section, SectionHeading } from "../storefront/storefront-ui";

/**
 * Vidéos de la boutique sur la page d'accueil. Reçoit UNIQUEMENT des vidéos
 * actives (non expirées — Zernio supprime les fichiers après 7 jours, voir
 * catalog-video-service.ts::listActiveStorefrontVideos) : la section
 * disparaît d'elle-même quand plus aucune vidéo n'est disponible.
 */
export function VideosSection({ videos }: { videos: CatalogVideo[]; site: StorefrontSite }) {
  if (videos.length === 0) return null;

  return (
    <Section>
      <SectionHeading title="En vidéo" subtitle="Découvrez nos produits et nos services en images animées." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos.slice(0, 3).map((video) => (
          <figure key={video.id} className="flex flex-col gap-2">
            <StorefrontVideo videoId={video.id} src={video.url} title={video.title ?? "Vidéo"} />
            {video.title && <figcaption className="text-sm font-semibold">{video.title}</figcaption>}
          </figure>
        ))}
      </div>
    </Section>
  );
}
