/**
 * Catégories suggérées par secteur d'activité — même esprit que
 * `INDUSTRY_MODULE_PRESETS` dans `modules.ts` (même fichier de référence
 * pour les valeurs d'industrie : `beauty`/`restaurant`/`real_estate`/
 * `retail`/`professional_services`, voir `onboarding-wizard.tsx`
 * `INDUSTRY_OPTIONS`). Sert à pré-remplir `categories` à la création de
 * l'organisation (`seedDefaultCategories`) — un point de départ cohérent,
 * pas une liste fermée : le marchand peut toujours en ajouter depuis
 * "Gérer les catégories" si son activité déborde du preset.
 */
export const INDUSTRY_CATEGORY_PRESETS: Record<string, string[]> = {
  retail: ["Vêtements Femme", "Vêtements Homme", "Chaussures", "Accessoires", "Enfants", "Autres"],
  restaurant: ["Entrées", "Plats", "Desserts", "Boissons", "Menus", "Autres"],
  beauty: ["Soins du visage", "Soins du corps", "Maquillage", "Cheveux", "Parfums", "Autres"],
  professional_services: ["Consultations", "Formations", "Abonnements", "Autres"],
  real_estate: ["Appartements", "Maisons", "Terrains", "Bureaux", "Commerces", "Autres"],
};

/** Secteur non renseigné ou hors liste (`organizations.industry` est un
 * `text` libre, pas un enum fermé — voir la note de `INDUSTRY_MODULE_PRESETS`). */
export const DEFAULT_CATEGORY_PRESET = ["Général", "Autres"];
