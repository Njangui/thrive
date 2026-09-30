import { IconPin } from "../../storefront/storefront-icons";
import { StorefrontImage } from "../../storefront/storefront-image";
import { Container } from "../../storefront/storefront-ui";
import type { RetailHomeModel, RetailProduct } from "../model";
import { CtaLink } from "../parts/cta-link";
import { TrackedProductLink } from "../parts/product-link";

/**
 * Hero : panneau sombre à gauche (titre, phrase, boutons), photo pleine
 * hauteur à droite, le tout aligné sur la même grille que l'en-tête et le
 * pied de page. Sur mobile, la photo passe au-dessus du texte.
 *
 * Le seul geste graphique de la page : la photo « se pose » au chargement
 * (voir retail-home.css). Tout le reste reste calme, pour que ce soient
 * les produits — et pas le décor — qui portent la page.
 *
 * L'en-tête du site est en surimpression sur ce hero (`homeOverlay` dans
 * StorefrontShell) : la photo reçoit un voile en haut pour que le menu
 * blanc reste lisible quelle que soit l'image du commerçant.
 */
export function Hero({ hero, organizationId }: { hero: RetailHomeModel["hero"]; organizationId: string }) {
  return (
    <section className="rt-hero" aria-labelledby="rt-hero-title">
      <div className="rt-hero__media">
        <StorefrontImage src={hero.mediaUrl} alt="" priority sizes="(min-width: 896px) 50vw, 100vw" fallbackLabel="" />
      </div>

      <Container className="rt-hero__inner">
        <div className="rt-hero__copy">
          {hero.location && (
            <p className="rt-place">
              <IconPin className="rt-place__icon" />
              {hero.location}
            </p>
          )}
          <h1 id="rt-hero-title" className="rt-h1">
            {hero.title}
          </h1>
          <p className="rt-lead">{hero.lead}</p>
          {(hero.primary || hero.secondary) && (
            <div className="rt-actions">
              {hero.primary && (
                <CtaLink cta={hero.primary} organizationId={organizationId} className="rt-btn rt-btn--accent" />
              )}
              {hero.secondary && (
                <CtaLink cta={hero.secondary} organizationId={organizationId} className="rt-btn rt-btn--outline-light" />
              )}
            </div>
          )}
        </div>

        {hero.spotlight && <Spotlight product={hero.spotlight} organizationId={organizationId} />}
      </Container>
    </section>
  );
}

/** Produit à la une, posé sur la photo : un vrai produit du catalogue, son vrai prix, un vrai lien. */
function Spotlight({ product, organizationId }: { product: RetailProduct; organizationId: string }) {
  const content = (
    <>
      <span className="rt-spot__media">
        <StorefrontImage src={product.imageUrl} alt="" sizes="88px" fallbackLabel="" />
      </span>
      <span className="rt-spot__text">
        <span className="rt-spot__label">À la une</span>
        <span className="rt-spot__name">{product.name}</span>
        <span className="rt-spot__price">{product.price}</span>
      </span>
    </>
  );

  return (
    <aside className="rt-spot" aria-label="Produit à la une">
      {product.href ? (
        <TrackedProductLink href={product.href} productId={product.id} organizationId={organizationId} className="rt-spot__link">
          {content}
        </TrackedProductLink>
      ) : (
        <div className="rt-spot__link">{content}</div>
      )}
    </aside>
  );
}
