import { z } from "zod";
import {
  FontChoiceSchema,
  HeroLayoutSchema,
  HexColorSchema,
  LANDING_SECTION_TYPES,
  LandingHighlightsSchema,
} from "./landing";

/**
 * Modèle de pages du site par blocs (C4, livrable C).
 *
 * Principe : l'agent (et l'éditeur) ne manipulent que des DONNÉES validées
 * par ces schémas — jamais du code. Chaque type de bloc a un schéma strict
 * (`.strict()` : toute clé inconnue est rejetée) et se rend par un composant
 * de la bibliothèque maîtrisée. Aucun HTML, aucun script : le texte libre
 * est du texte brut (le bloc HTML assaini viendra à l'étape 3 du brief).
 *
 * Un « site » = un instantané complet (thème + navigation + pages) stocké
 * dans `site_versions.snapshot`. Brouillon / publié / archivé = statut de la
 * version ; publier et restaurer sont donc atomiques.
 */

export const SITE_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const MAX_PAGES = 30;
export const MAX_BLOCKS_PER_PAGE = 40;
export const MAX_NAV_ITEMS = 8;

/** Lien sûr : chemin relatif du site (« /contact ») ou URL https. Jamais `javascript:`, `data:` ni `//hôte`. */
export function isSafeLink(value: string): boolean {
  if (value.length === 0 || value.length > 500) return false;
  if (value.startsWith("/")) return !value.startsWith("//") && !/[\s\\]/.test(value);
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
export const SafeLinkSchema = z.string().refine(isSafeLink, "Lien invalide (chemin « /… » ou URL https uniquement)");

/** URL d'image/média : https uniquement. */
export const MediaUrlSchema = z
  .string()
  .max(1000)
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "URL de média invalide (https uniquement)");

/** Segments déjà occupés par des routes du produit : une page ne peut pas les prendre (collision de routage). */
export const RESERVED_PAGE_SLUGS = [
  "produits", "services", "categories", "promotions", "galerie", "faq", "contact", "a-propos", "rendez-vous",
  "api", "dashboard", "admin", "affiliate", "devenir-affilie", "auth", "login", "signup", "invite", "onboarding",
  "reset-password", "tarifs", "cgu", "confidentialite", "mentions-legales", "r", "sitemap", "robots",
] as const;

/**
 * Blocs riches du « site libre » (mode `free`). Contrairement aux sections du moteur, ils portent leur
 * PROPRE contenu (textes, images, liens) : l'agent compose une page entière avec eux. Chacun se rend par
 * un composant maîtrisé (`rich-blocks.tsx`) ; aucun HTML ni script n'est accepté.
 */
export const RICH_BLOCK_TYPES = [
  "rich_hero", "rich_text", "feature_grid", "image_text", "steps", "stats", "pricing", "quotes", "cta_band", "faq_list", "image_gallery", "divider",
] as const;
export type RichBlockType = (typeof RICH_BLOCK_TYPES)[number];

export const BLOCK_TYPES = [...LANDING_SECTION_TYPES, "text", ...RICH_BLOCK_TYPES] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const SITE_MODES = ["template", "free"] as const;
export type SiteMode = (typeof SITE_MODES)[number];

/**
 * Ce que chaque type de page sait RENDRE (pas de bloc accepté « pour plus tard » :
 * il serait enregistré, publié, et invisible).
 *  - Accueil : les sections du moteur actuel, une seule fois chacune ; pas de `text`
 *    (les gabarits sectoriels sont monolithiques et ne peuvent pas l'intercaler).
 *  - Page supplémentaire : `text` et les sections de données autonomes. Ni `hero` ni
 *    `cta` (réglés au niveau du site) ni `booking` (formulaire lié à la page d'accueil).
 */
export const HOME_BLOCK_TYPES: readonly BlockType[] = LANDING_SECTION_TYPES;
/**
 * Site libre : toutes les pages (accueil compris) se composent des blocs riches, du texte et des sections de
 * données autonomes, dans l'ordre et en autant d'exemplaires que voulu. Ni `hero`/`cta` (remplacés par
 * `rich_hero`/`cta_band`) ni `booking` (formulaire lié au gabarit de l'accueil).
 */
export const FREE_BLOCK_TYPES: readonly BlockType[] = [
  ...RICH_BLOCK_TYPES, "text", "about", "products", "services", "categories", "promotions", "gallery", "testimonials", "team", "faq", "contact", "location", "social_links",
];
export const PAGE_BLOCK_TYPES: readonly BlockType[] = [
  "text", "about", "products", "services", "categories", "promotions", "gallery", "testimonials", "team", "faq", "contact", "location", "social_links",
];

const BlockIdSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const ShortText = (max: number) => z.string().max(max);

const HeroPropsSchema = z
  .object({
    title: ShortText(120).optional(),
    subtitle: ShortText(300).optional(),
    ctaLabel: ShortText(40).optional(),
    ctaUrl: SafeLinkSchema.optional(),
    secondaryCtaLabel: ShortText(40).optional(),
    secondaryCtaUrl: SafeLinkSchema.optional(),
    layout: HeroLayoutSchema.optional(),
    mediaUrl: MediaUrlSchema.optional(),
    /** Texte alternatif du visuel (accessibilité + SEO image). */
    mediaAlt: ShortText(125).optional(),
  })
  .strict();

const TextPropsSchema = z
  .object({
    heading: ShortText(120).optional(),
    /** Texte brut ; les sauts de ligne séparent les paragraphes. */
    body: ShortText(5000),
  })
  .strict();

/**
 * Blocs sans réglage propre : leur contenu vient du catalogue, de la FAQ, de la
 * galerie… du tenant, et leurs intitulés du modèle sectoriel. Le moteur actuel ne
 * lit AUCUN titre / sous-titre / nombre d'éléments pour eux : les accepter ici
 * produirait un réglage sans effet. Ils s'ajouteront à ce schéma le jour où un
 * composant les lira (même règle pour `cta`, dont le texte vient du hero).
 */
const NoPropsSchema = z.object({}).strict();

// ── Blocs riches (site libre) ────────────────────────────────────────────────
const StyleShape = {
  background: z.enum(["default", "soft", "brand", "dark"]).optional(),
  align: z.enum(["left", "center"]).optional(),
  spacing: z.enum(["compact", "normal", "spacious"]).optional(),
};
const LinkButton = z.object({ label: ShortText(40).min(1), href: SafeLinkSchema }).strict();
const Heading = ShortText(120);

const RichHeroProps = z.object({
  eyebrow: ShortText(60).optional(),
  title: ShortText(120).min(1),
  subtitle: ShortText(300).optional(),
  primaryCta: LinkButton.optional(),
  secondaryCta: LinkButton.optional(),
  mediaUrl: MediaUrlSchema.optional(),
  mediaAlt: ShortText(125).optional(),
  layout: HeroLayoutSchema.optional(),
  ...StyleShape,
}).strict();
const RichTextProps = z.object({ eyebrow: ShortText(60).optional(), heading: Heading.optional(), body: ShortText(5000).min(1), ...StyleShape }).strict();
const FeatureGridProps = z.object({
  heading: Heading.optional(), subtitle: ShortText(300).optional(), columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  items: z.array(z.object({ icon: ShortText(8).optional(), title: ShortText(60).min(1), text: ShortText(240).optional() }).strict()).min(1).max(12),
  ...StyleShape,
}).strict();
const ImageTextProps = z.object({
  heading: Heading.optional(), body: ShortText(2000).min(1), mediaUrl: MediaUrlSchema, mediaAlt: ShortText(125).min(1),
  imageSide: z.enum(["left", "right"]).optional(), cta: LinkButton.optional(), ...StyleShape,
}).strict();
const StepsProps = z.object({
  heading: Heading.optional(), subtitle: ShortText(300).optional(),
  items: z.array(z.object({ title: ShortText(80).min(1), text: ShortText(300).optional() }).strict()).min(2).max(8), ...StyleShape,
}).strict();
const StatsProps = z.object({
  heading: Heading.optional(),
  items: z.array(z.object({ value: ShortText(16).min(1), label: ShortText(60).min(1) }).strict()).min(2).max(6), ...StyleShape,
}).strict();
const PricingProps = z.object({
  heading: Heading.optional(), subtitle: ShortText(300).optional(),
  plans: z.array(z.object({
    name: ShortText(40).min(1), price: ShortText(30).min(1), period: ShortText(20).optional(), description: ShortText(160).optional(),
    features: z.array(ShortText(80).min(1)).max(10), cta: LinkButton.optional(), highlighted: z.boolean().optional(),
  }).strict()).min(1).max(4), ...StyleShape,
}).strict();
const QuotesProps = z.object({
  heading: Heading.optional(),
  items: z.array(z.object({ quote: ShortText(400).min(1), author: ShortText(60).min(1), role: ShortText(60).optional() }).strict()).min(1).max(6), ...StyleShape,
}).strict();
const CtaBandProps = z.object({ heading: Heading.min(1), text: ShortText(300).optional(), cta: LinkButton, secondaryCta: LinkButton.optional(), ...StyleShape }).strict();
const FaqListProps = z.object({
  heading: Heading.optional(),
  items: z.array(z.object({ question: ShortText(200).min(1), answer: ShortText(1000).min(1) }).strict()).min(1).max(15), ...StyleShape,
}).strict();
const ImageGalleryProps = z.object({
  heading: Heading.optional(), columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  images: z.array(z.object({ url: MediaUrlSchema, alt: ShortText(125).min(1), caption: ShortText(120).optional() }).strict()).min(1).max(12), ...StyleShape,
}).strict();
const DividerProps = z.object({ spacing: z.enum(["compact", "normal", "spacious"]).optional() }).strict();

function block<T extends BlockType, P extends z.ZodTypeAny>(type: T, props: P) {
  return z.object({ id: BlockIdSchema, type: z.literal(type), visible: z.boolean(), props }).strict();
}

export const BlockSchema = z.discriminatedUnion("type", [
  block("hero", HeroPropsSchema),
  block("text", TextPropsSchema),
  block("cta", NoPropsSchema),
  block("about", NoPropsSchema),
  block("products", NoPropsSchema),
  block("services", NoPropsSchema),
  block("categories", NoPropsSchema),
  block("promotions", NoPropsSchema),
  block("gallery", NoPropsSchema),
  block("testimonials", NoPropsSchema),
  block("team", NoPropsSchema),
  block("faq", NoPropsSchema),
  block("booking", NoPropsSchema),
  block("contact", NoPropsSchema),
  block("location", NoPropsSchema),
  block("social_links", NoPropsSchema),
  block("rich_hero", RichHeroProps),
  block("rich_text", RichTextProps),
  block("feature_grid", FeatureGridProps),
  block("image_text", ImageTextProps),
  block("steps", StepsProps),
  block("stats", StatsProps),
  block("pricing", PricingProps),
  block("quotes", QuotesProps),
  block("cta_band", CtaBandProps),
  block("faq_list", FaqListProps),
  block("image_gallery", ImageGalleryProps),
  block("divider", DividerProps),
]);
export type Block = z.infer<typeof BlockSchema>;

export const PageSeoSchema = z
  .object({
    title: ShortText(120).optional(),
    description: ShortText(320).optional(),
    ogImageUrl: MediaUrlSchema.optional(),
    noindex: z.boolean().optional(),
  })
  .strict();
export type PageSeo = z.infer<typeof PageSeoSchema>;

export const PageSlugSchema = z
  .string()
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug invalide (minuscules, chiffres et tirets)");

export const PageSchema = z
  .object({
    id: BlockIdSchema,
    kind: z.enum(["home", "page"]),
    /** Accueil = chaîne vide. */
    slug: z.string().max(60),
    title: ShortText(120).min(1),
    seo: PageSeoSchema,
    blocks: z.array(BlockSchema).max(MAX_BLOCKS_PER_PAGE),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (page.kind === "home") {
      if (page.slug !== "") ctx.addIssue({ code: "custom", path: ["slug"], message: "L'accueil a un slug vide" });
    } else {
      if (!PageSlugSchema.safeParse(page.slug).success) {
        ctx.addIssue({ code: "custom", path: ["slug"], message: "Slug invalide (minuscules, chiffres et tirets)" });
      } else if ((RESERVED_PAGE_SLUGS as readonly string[]).includes(page.slug)) {
        ctx.addIssue({ code: "custom", path: ["slug"], message: `Le slug « ${page.slug} » est réservé par une route du site` });
      }
    }
    const ids = new Set<string>();
    page.blocks.forEach((b, i) => {
      if (ids.has(b.id)) ctx.addIssue({ code: "custom", path: ["blocks", i, "id"], message: "Identifiant de bloc en double" });
      ids.add(b.id);
    });
  });
export type Page = z.infer<typeof PageSchema>;

export const ThemeSchema = z
  .object({
    brandColorPrimary: HexColorSchema.nullable(),
    brandColorSecondary: HexColorSchema.nullable(),
    fontChoice: FontChoiceSchema,
    visualStyle: z.enum(["soft", "clean", "bold"]),
  })
  .strict();
export type Theme = z.infer<typeof ThemeSchema>;

export const NavItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), label: ShortText(30).min(1), pageId: BlockIdSchema }).strict(),
  z.object({ kind: z.literal("link"), label: ShortText(30).min(1), href: SafeLinkSchema }).strict(),
]);
export type NavItem = z.infer<typeof NavItemSchema>;

export const SiteSnapshotSchema = z
  .object({
    schemaVersion: z.literal(SITE_SNAPSHOT_SCHEMA_VERSION),
    /** Absent = `template` (gabarits sectoriels, comportement historique). `free` = site composé de blocs riches. */
    mode: z.enum(SITE_MODES).optional(),
    theme: ThemeSchema,
    /** Entrées AJOUTÉES au menu du produit (qui reste en place, « Contact » en dernier). Vide = menu inchangé. */
    navigation: z.array(NavItemSchema).max(MAX_NAV_ITEMS),
    announcement: z.object({ text: ShortText(200), enabled: z.boolean() }).strict().nullable(),
    /** `null` = promesses par défaut du secteur (même sémantique que `LandingConfig.highlights`). */
    highlights: LandingHighlightsSchema.nullable(),
    pages: z.array(PageSchema).min(1).max(MAX_PAGES),
  })
  .strict()
  .superRefine((site, ctx) => {
    const homes = site.pages.filter((p) => p.kind === "home");
    if (homes.length !== 1) ctx.addIssue({ code: "custom", path: ["pages"], message: "Il faut exactement une page d'accueil" });
    const slugs = new Set<string>();
    const ids = new Set<string>();
    const free = site.mode === "free";
    site.pages.forEach((p, pageIndex) => {
      const allowed = free ? FREE_BLOCK_TYPES : p.kind === "home" ? HOME_BLOCK_TYPES : PAGE_BLOCK_TYPES;
      const seen = new Set<string>();
      p.blocks.forEach((b, i) => {
        const path = ["pages", pageIndex, "blocks", i, "type"];
        if (!allowed.includes(b.type)) {
          const where = free ? "du site libre" : p.kind === "home" ? "sur la page d'accueil" : "sur une page supplémentaire";
          ctx.addIssue({ code: "custom", path, message: `Le bloc « ${b.type} » n'est pas disponible ${where}` });
        }
        // Gabarit sectoriel : une section par type sur l'accueil (le moteur la désigne par son type).
        if (!free && p.kind === "home") {
          if (seen.has(b.type)) ctx.addIssue({ code: "custom", path, message: `La section « ${b.type} » est déjà sur la page d'accueil` });
          seen.add(b.type);
        }
      });
    });
    site.pages.forEach((p, i) => {
      if (slugs.has(p.slug)) ctx.addIssue({ code: "custom", path: ["pages", i, "slug"], message: "Slug en double" });
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", path: ["pages", i, "id"], message: "Identifiant de page en double" });
      slugs.add(p.slug);
      ids.add(p.id);
    });
    site.navigation.forEach((item, i) => {
      if (item.kind === "page" && !ids.has(item.pageId)) {
        ctx.addIssue({ code: "custom", path: ["navigation", i, "pageId"], message: "Page de navigation introuvable" });
      }
    });
  });
export type SiteSnapshot = z.infer<typeof SiteSnapshotSchema>;

export const SITE_VERSION_STATUSES = ["draft", "published", "archived"] as const;
export type SiteVersionStatus = (typeof SITE_VERSION_STATUSES)[number];
export const SITE_VERSION_SOURCES = ["default_from_config", "manual", "agent", "restore"] as const;
export type SiteVersionSource = (typeof SITE_VERSION_SOURCES)[number];

/** Libellés lisibles des blocs riches (éditeur, historique, aperçus de l'assistant). */
export const RICH_BLOCK_LABELS: Record<RichBlockType, string> = {
  rich_hero: "En-tête (hero)", rich_text: "Texte mis en forme", feature_grid: "Grille d'atouts", image_text: "Image + texte", steps: "Étapes",
  stats: "Chiffres clés", pricing: "Tarifs", quotes: "Témoignages", cta_band: "Bandeau d'appel à l'action", faq_list: "Questions fréquentes",
  image_gallery: "Galerie d'images", divider: "Séparateur",
};
export const isRichBlockType = (type: string): type is RichBlockType => (RICH_BLOCK_TYPES as readonly string[]).includes(type);
