import Link from "next/link";
import { StorefrontImage } from "../../storefront/storefront-image";
import type { RestaurantHomeModel } from "../restaurant-model";

/**
 * La maison : le texte du commerçant, et rien d'autre. Aucune phrase
 * d'ambiance écrite d'avance — l'ancien template affichait « Cuisine
 * authentique et créative » chez tous les restaurants, y compris ceux dont ce
 * n'était pas vrai. Sans texte de sa part, la section n'existe pas (voir le
 * modèle) : une photo seule ne raconterait rien.
 *
 * Les « highlights » du blueprint ne sont pas repris ici : ce sont des phrases
 * de plateforme (« Découvrez les plats publiés ») qui parlent du site, pas du
 * restaurant.
 */
export function StorySection({ story }: { story: NonNullable<RestaurantHomeModel["story"]> }) {
  const paragraphs = story.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <section className="rl-section rl-section--tint" aria-labelledby="rl-story-title">
      <div className={`rl-wrap rl-story${story.imageUrl ? "" : " rl-story--plain"}`}>
        {story.imageUrl && (
          <div className="rl-story__media">
            <StorefrontImage src={story.imageUrl} alt="" sizes="(min-width: 900px) 40vw, 100vw" fallbackLabel="" />
          </div>
        )}

        <div className="rl-story__copy">
          <h2 id="rl-story-title" className="rl-h2">
            {story.heading}
          </h2>

          <div className="rl-prose">
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          {story.aboutHref && (
            <Link href={story.aboutHref} className="rl-btn rl-btn--outline">
              Découvrir la maison
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
