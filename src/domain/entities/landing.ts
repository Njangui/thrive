import { z } from "zod";

/**
 * Types de section supportés (cahier Lot K, correspondant exactement à la
 * liste du master prompt section 15). "footer" n'en fait PAS partie —
 * jamais une section activable/désactivable, toujours rendue (cohérence
 * de marque, voir landing-sections/footer.tsx).
 */
export const LANDING_SECTION_TYPES = [
  "hero",
  "about",
  "products",
  "services",
  "categories",
  "promotions",
  "gallery",
  "testimonials",
  "team",
  "faq",
  "booking",
  "contact",
  "location",
  "social_links",
  "cta",
] as const;

export const LandingSectionTypeSchema = z.enum(LANDING_SECTION_TYPES);
export type LandingSectionType = (typeof LANDING_SECTION_TYPES)[number];

/**
 * Une entrée du tableau `organization_landing_config.sections`.
 * `config` reste volontairement `passthrough`/non typé plus finement :
 * aucune section de ce lot n'a besoin de réglages par-section au-delà de
 * l'activation/l'ordre (pas de sur-ingénierie prématurée, même esprit que
 * product_images/galerie multi-photos, catalog-service.ts) — le champ
 * existe déjà au niveau du schéma JSONB pour ne pas bloquer une évolution
 * future, mais n'est ni lu ni écrit par ce lot.
 */
export const LandingSectionSchema = z.object({
  type: LandingSectionTypeSchema,
  enabled: z.boolean(),
  order: z.number().int().min(0),
  config: z.record(z.unknown()).optional(),
});
export type LandingSection = z.infer<typeof LandingSectionSchema>;

export const LandingSectionsSchema = z.array(LandingSectionSchema);

export const FONT_CHOICES = ["modern", "classic", "friendly"] as const;
export const FontChoiceSchema = z.enum(FONT_CHOICES);
export type FontChoice = (typeof FONT_CHOICES)[number];

/** Couleur hex stricte — celle produite par un `<input type="color">` (jamais une valeur CSS arbitraire, voir dashboard/site). */
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
export const HexColorSchema = z.string().regex(HEX_COLOR_REGEX, "Couleur invalide (format attendu : #rrggbb)");

export const TestimonialSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  authorName: z.string(),
  content: z.string(),
  rating: z.number().int().min(1).max(5).nullable(),
  displayOrder: z.number().int(),
  createdAt: z.string(),
});
export type Testimonial = z.infer<typeof TestimonialSchema>;
