import type { CSSProperties } from "react";
import { buildRestaurantHomeModel, type RestaurantHomeInput } from "./restaurant-model";
import { RestaurantHero } from "./sections/hero";
import { DishesSection } from "./sections/dishes";
import { MenuSection } from "./sections/menu";
import { StorySection } from "./sections/story";
import { GallerySection } from "./sections/gallery";
import { TestimonialsSection } from "./sections/testimonials";
import { VisitSection } from "./sections/visit";
import "./restaurant-home.css";

/**
 * Page d'accueil du template RESTAURANT.
 *
 * Ce fichier ne fait qu'assembler. L'organisation est volontairement plate :
 *
 *   restaurant-model.ts   ce qu'on affiche et pourquoi (fonctions pures, testées)
 *   restaurant-home.css   tout le style, préfixé `rl-`, une seule feuille
 *   sections/*.tsx        une section = un fichier
 *   restaurant-ui.tsx     briques partagées (bouton, titre, prix, ligne de carte)
 *   hours-client.tsx      seuls composants clients : le jour courant dans le navigateur
 *
 * Chaque section n'existe que si elle a du contenu réel (ou d'exemple signalé
 * comme tel) : le modèle renvoie `null` sinon, et rien n'est rendu.
 *
 * Couleurs, police et arrondi viennent de la marque du commerçant (variables
 * posées par `StorefrontShell`) : ce template n'impose aucune couleur en dur.
 * Le texte posé sur l'accent et l'accent utilisé comme texte sont calculés pour
 * rester lisibles quelle que soit la couleur choisie (restaurant-theme.ts).
 */
export function RestaurantHome(input: RestaurantHomeInput) {
  const model = buildRestaurantHomeModel(input);
  const organizationId = input.site.tenant.organizationId;

  // Couleurs lisibles calculées d'après l'accent réel (voir restaurant-theme.ts) ; sans elles, la feuille de style utilise son calcul de repli.
  const themeStyle = model.theme
    ? ({ "--rl-on-accent": model.theme.onAccent, "--rl-accent-ink": model.theme.ink } as CSSProperties)
    : undefined;

  return (
    <div className="rl" style={themeStyle}>
      <RestaurantHero model={model} organizationId={organizationId} />
      {model.dishes && <DishesSection dishes={model.dishes} />}
      {model.menu && <MenuSection menu={model.menu} />}
      {model.story && <StorySection story={model.story} />}
      {model.gallery && <GallerySection gallery={model.gallery} />}
      {model.testimonials && <TestimonialsSection testimonials={model.testimonials} />}
      {model.visit && <VisitSection visit={model.visit} hours={model.hours} organizationId={organizationId} />}
    </div>
  );
}
