import type { CatalogVideo } from "@/application/services/catalog-video-service";
import { StorefrontVideo } from "../../storefront/storefront-video";
import { Container } from "../../storefront/storefront-ui";
import { SectionHead } from "../parts/section-head";

/**
 * Vidéos du catalogue. Reçoit UNIQUEMENT des vidéos actives (non expirées :
 * Zernio supprime les fichiers après 7 jours, voir
 * `catalog-video-service.ts::listActiveStorefrontVideos`) — la section
 * disparaît d'elle-même quand il n'y en a plus.
 *
 * CORRECTIF : les vitrines sectorielles ne rendaient JAMAIS ces vidéos
 * (elles n'étaient insérées que par le compositeur générique de
 * `TenantLanding`), alors que le catalogue vidéo est ouvert à tous les
 * secteurs.
 */
export function Videos({ videos }: { videos: CatalogVideo[] }) {
  if (videos.length === 0) return null;

  return (
    <section className="rt-videos" aria-labelledby="rt-videos-title">
      <Container>
        <SectionHead id="rt-videos-title" title="En vidéo" subtitle="Nos produits en images animées." />
        <ul className="rt-videos__grid" data-count={videos.length}>
          {videos.map((video) => (
            <li key={video.id}>
              <figure className="rt-videos__item">
                <StorefrontVideo videoId={video.id} src={video.url} title={video.title ?? "Vidéo"} className="rt-videos__player" />
                {video.title && <figcaption className="rt-videos__caption">{video.title}</figcaption>}
              </figure>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
