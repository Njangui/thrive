/**
 * Contenu d'APERÇU de la landing boutique.
 *
 * Utilisé uniquement quand le tenant n'a encore ni produit ni catégorie
 * (voir `buildRetailHomeModel`) : la vitrine garde alors une composition
 * lisible au lieu d'un écran vide. Règle du projet (V15/V19) : ces
 * contenus sont TOUJOURS étiquetés « Exemple » à l'écran, jamais présentés
 * comme des données du commerçant, et disparaissent dès qu'il publie un
 * vrai produit. Ils vivaient auparavant en plein milieu du JSX de
 * `sector-home.tsx` ; ils sont regroupés ici pour être retrouvés (et
 * remplacés) en un seul endroit.
 */

export const PREVIEW_HERO_IMAGE = "/images/showcase/retail-hero.svg";

export const PREVIEW_CATEGORIES = [
  { name: "Mode", image: "/images/demo/retail-mode.svg" },
  { name: "Accessoires", image: "/images/demo/retail-accessories.svg" },
  { name: "Maison", image: "/images/demo/retail-home.svg" },
  { name: "Beauté", image: "/images/demo/retail-beauty.svg" },
] as const;

export const PREVIEW_PRODUCTS = [
  { name: "Pièce signature", price: 25000, image: "/images/demo/retail-fashion.svg", category: "Mode" },
  { name: "Sac essentiel", price: 35000, image: "/images/demo/retail-bag.svg", category: "Accessoires" },
  { name: "Objet maison", price: 18000, image: "/images/demo/retail-home.svg", category: "Maison" },
  { name: "Soin du quotidien", price: 12000, image: "/images/demo/retail-beauty.svg", category: "Beauté" },
] as const;

export const PREVIEW_QUOTES = [
  { author: "Cliente exemple", content: "Une sélection facile à parcourir et un contact direct quand j’ai besoin d’aide." },
  { author: "Client exemple", content: "Le catalogue donne immédiatement une idée des produits et des prix." },
] as const;
