import Link from "next/link";
import { StorefrontImage } from "../../storefront/storefront-image";
import type { DishView, RestaurantHomeModel } from "../restaurant-model";
import { MenuLine, Price, SectionHead } from "../restaurant-ui";

function DishBadges({ badges }: { badges: DishView["badges"] }) {
  if (badges.length === 0) return null;
  return (
    <span className="rl-dish__badges">
      {badges.map((badge) => (
        <span key={badge.key} className={`rl-badge rl-badge--${badge.key}`}>
          {badge.label}
        </span>
      ))}
    </span>
  );
}

function DishCaption({ dish }: { dish: DishView }) {
  return (
    <span className="rl-dish__caption">
      <MenuLine label={dish.name} value={<Price amount={dish.price} compare={dish.comparePrice} />} />
      {dish.description && <span className="rl-dish__desc">{dish.description}</span>}
    </span>
  );
}

/** Vedette : grande photo, nom, prix. Le lien enveloppe toute la carte : une seule cible de clic, un seul arrêt clavier. */
function DishFeature({ dish }: { dish: DishView }) {
  return (
    <Link href={dish.href} className="rl-dish rl-dish--feature">
      <span className="rl-dish__media">
        {dish.imageUrl && <StorefrontImage src={dish.imageUrl} alt="" sizes="(min-width: 900px) 46vw, 100vw" />}
        <DishBadges badges={dish.badges} />
      </span>
      <DishCaption dish={dish} />
    </Link>
  );
}

/** Ligne de liste : petite vignette si le plat est photographié, sinon texte seul — jamais un carré gris « Photo à venir ». */
function DishRow({ dish }: { dish: DishView }) {
  return (
    <Link href={dish.href} className="rl-dish rl-dish--row">
      {dish.imageUrl && (
        <span className="rl-dish__thumb">
          <StorefrontImage src={dish.imageUrl} alt="" sizes="112px" />
        </span>
      )}
      <DishCaption dish={dish} />
    </Link>
  );
}

function DishCard({ dish }: { dish: DishView }) {
  return (
    <Link href={dish.href} className="rl-dish rl-dish--card">
      <span className="rl-dish__media">
        {dish.imageUrl && <StorefrontImage src={dish.imageUrl} alt="" sizes="(min-width: 900px) 25vw, (min-width: 560px) 50vw, 100vw" />}
        <DishBadges badges={dish.badges} />
      </span>
      <DishCaption dish={dish} />
    </Link>
  );
}

/**
 * Plats phares. Quatre mises en page selon ce qui est réellement photographié
 * (voir `buildDishes`) : vedette + liste, vedette seule, grille de cartes, ou
 * simple liste.
 * Le nom accessible d'un lien est son contenu (nom + prix + description) : les
 * photos sont décoratives (`alt=""`), le plat est déjà nommé juste à côté.
 */
export function DishesSection({ dishes }: { dishes: NonNullable<RestaurantHomeModel["dishes"]> }) {
  const [first, ...rest] = dishes.items;
  return (
    <section className="rl-section" aria-labelledby="rl-dishes-title">
      <div className="rl-wrap">
        <SectionHead
          id="rl-dishes-title"
          title={dishes.heading}
          subtitle={dishes.subheading}
          action={dishes.catalogHref ? { label: "Voir toute la carte", href: dishes.catalogHref } : null}
        />

        {dishes.layout === "feature-list" && first && (
          <div className="rl-dishes rl-dishes--feature">
            <DishFeature dish={first} />
            <ul className="rl-dishes__list">
              {rest.map((dish) => (
                <li key={dish.id}>
                  <DishRow dish={dish} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {dishes.layout === "spotlight" && first && (
          <div className="rl-dishes rl-dishes--spotlight">
            <DishFeature dish={first} />
          </div>
        )}

        {dishes.layout === "cards" && (
          <ul className="rl-dishes rl-dishes--cards">
            {dishes.items.map((dish) => (
              <li key={dish.id}>
                <DishCard dish={dish} />
              </li>
            ))}
          </ul>
        )}

        {dishes.layout === "lines" && (
          <ul className="rl-dishes rl-dishes--lines">
            {dishes.items.map((dish) => (
              <li key={dish.id}>
                <DishRow dish={dish} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
