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
  config: z.record(z.string(), z.unknown()).optional(),
});
export type LandingSection = z.infer<typeof LandingSectionSchema>;

export const LandingSectionsSchema = z.array(LandingSectionSchema);

export const FONT_CHOICES = ["modern", "classic", "friendly"] as const;
export const FontChoiceSchema = z.enum(FONT_CHOICES);
export type FontChoice = (typeof FONT_CHOICES)[number];

/** Couleur hex stricte — celle produite par un `<input type="color">` (jamais une valeur CSS arbitraire, voir dashboard/site). */
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
export const HexColorSchema = z.string().regex(HEX_COLOR_REGEX, "Couleur invalide (format attendu : #rrggbb)");

/**
 * ============================================================
 * Vitrine V2 (sept. 2026)
 * ============================================================
 */

/** Icônes disponibles pour la bande de confiance — miroir de `StorefrontIconKey` (storefront-blueprint.ts), validé ici parce que ces valeurs arrivent d'un formulaire et finissent en base. */
export const HIGHLIGHT_ICON_KEYS = [
  "truck",
  "wallet",
  "shield",
  "headset",
  "clock",
  "pin",
  "sparkles",
  "star",
  "chef",
  "leaf",
  "scissors",
  "calendar",
  "briefcase",
  "handshake",
  "key",
  "ruler",
  "whatsapp",
  "bag",
] as const;
export const HighlightIconSchema = z.enum(HIGHLIGHT_ICON_KEYS);
export type HighlightIconKey = (typeof HIGHLIGHT_ICON_KEYS)[number];

export const LandingHighlightSchema = z.object({
  icon: HighlightIconSchema,
  title: z.string().min(1).max(60),
  subtitle: z.string().max(90),
});
export type LandingHighlight = z.infer<typeof LandingHighlightSchema>;

/** Au plus 4 : au-delà, la bande passe sur deux lignes et perd sa fonction de repère rapide. */
export const LandingHighlightsSchema = z.array(LandingHighlightSchema).max(4);

export const PAYMENT_METHOD_KEYS = ["mtn", "orange", "cash", "visa", "mastercard", "bank"] as const;
export const PaymentMethodSchema = z.enum(PAYMENT_METHOD_KEYS);
export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];
export const PaymentMethodsSchema = z.array(PaymentMethodSchema);

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodKey, string> = {
  mtn: "MTN Mobile Money",
  orange: "Orange Money",
  cash: "Espèces à la livraison",
  visa: "Visa",
  mastercard: "Mastercard",
  bank: "Virement bancaire",
};

export const HERO_LAYOUTS = ["split", "centered", "banner"] as const;
export const HeroLayoutSchema = z.enum(HERO_LAYOUTS);
export type HeroLayout = (typeof HERO_LAYOUTS)[number];

export const HERO_LAYOUT_LABELS: Record<HeroLayout, string> = {
  split: "Texte + visuel côte à côte",
  centered: "Texte centré, sans visuel",
  banner: "Bannière pleine largeur",
};

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
