import Link from "next/link";
import { IconArrowRight } from "../../storefront/storefront-icons";
import { StorefrontImage } from "../../storefront/storefront-image";
import type { MenuRow, RestaurantHomeModel } from "../restaurant-model";
import { MenuLine } from "../restaurant-ui";

function RowBody({ row }: { row: MenuRow }) {
  return (
    <>
      {row.imageUrl && (
        <span className="rl-carte__thumb">
          <StorefrontImage src={row.imageUrl} alt="" sizes="64px" fallbackLabel="" />
        </span>
      )}
      <MenuLine label={row.name} value={row.countLabel} />
      {row.href && <IconArrowRight className="rl-carte__arrow" />}
    </>
  );
}

/**
 * « La carte » : les catégories présentées comme les lignes d'une vraie carte
 * de restaurant — nom, pointillés, nombre de plats. C'est plus lisible qu'une
 * grille de vignettes (le nom est lu en premier, pas la photo), et ça tient
 * avec ou sans photo de catégorie. Sur fond sombre : la seule section sombre
 * après le hero, comme l'ardoise d'un restaurant.
 */
export function MenuSection({ menu }: { menu: NonNullable<RestaurantHomeModel["menu"]> }) {
  return (
    <section className="rl-section rl-section--forest" aria-labelledby="rl-menu-title">
      <div className="rl-wrap rl-carte">
        <div className="rl-carte__intro">
          <h2 id="rl-menu-title" className="rl-h2">
            {menu.heading}
            {menu.isDemo && <span className="rl-badge rl-badge--demo">Exemple</span>}
          </h2>
          {menu.subheading && <p className="rl-carte__sub">{menu.subheading}</p>}
          {menu.catalogHref && (
            <Link href={menu.catalogHref} className="rl-btn rl-btn--light">
              Voir toute la carte
            </Link>
          )}
        </div>

        <ul className="rl-carte__list">
          {menu.rows.map((row) => (
            <li key={row.id}>
              {row.href ? (
                <Link href={row.href} className="rl-carte__row">
                  <RowBody row={row} />
                </Link>
              ) : (
                <div className="rl-carte__row rl-carte__row--static">
                  <RowBody row={row} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
