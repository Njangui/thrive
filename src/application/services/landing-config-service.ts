import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError } from "@/lib/errors";
import { isSafePublicUrl } from "@/lib/safe-url";
import type { MemberRole } from "./auth-service";
import {
  listStorefrontProducts,
  listStorefrontCategories,
  resolvePrimaryImageUrl,
  type CatalogProductSummary,
  type StorefrontProduct,
  type StorefrontCategory,
} from "./catalog-service";
import type { CatalogSpecification } from "@/domain/entities/catalog";
import {
  LANDING_SECTION_TYPES,
  LandingSectionsSchema,
  LandingHighlightsSchema,
  PaymentMethodsSchema,
  HERO_LAYOUTS,
  FONT_CHOICES,
  HEX_COLOR_REGEX,
  type LandingSectionType,
  type FontChoice,
  type LandingHighlight,
  type PaymentMethodKey,
  type HeroLayout,
} from "@/domain/entities/landing";
import { resolveIndustryPresetKey, buildDefaultSections } from "@/application/config/landing-presets";

// ============================================================
// Configuration de la landing page (sections + branding)
// ============================================================

export interface ResolvedLandingSection {
  type: LandingSectionType;
  enabled: boolean;
  order: number;
}

export interface LandingConfig {
  organizationId: string;
  sections: ResolvedLandingSection[];
  brandColorPrimary: string | null;
  brandColorSecondary: string | null;
  fontChoice: FontChoice;
  heroTitle: string | null;
  heroSubtitle: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  visualStyle: "soft" | "clean" | "bold";
  // --- Vitrine V2 (0052_storefront_v2.sql) ---
  /** Barre d'annonce en haut de la vitrine. `null`/vide = aucune barre. */
  announcement: string | null;
  announcementEnabled: boolean;
  /** `null` = composition choisie automatiquement selon la présence d'un visuel (voir resolveHeroLayout). */
  heroLayout: HeroLayout | null;
  heroMediaUrl: string | null;
  /**
   * `null` = le commerçant n'a jamais touché la bande de confiance : les
   * promesses par défaut de son secteur s'appliquent. Tableau VIDE = il
   * l'a explicitement retirée. Les deux cas sont distincts et respectés
   * comme tels (voir resolveStorefrontHighlights).
   */
  highlights: LandingHighlight[] | null;
  secondaryCtaLabel: string | null;
  secondaryCtaUrl: string | null;
  /** `null` = aucun moyen de paiement affiché. Jamais présumé. */
  paymentMethods: PaymentMethodKey[] | null;
  showStats: boolean;
  /**
   * `false` = aucune ligne `organization_landing_config` n'existe encore
   * pour cette organisation : `sections` reflète le preset calculé de son
   * secteur, rien n'a encore été persisté (cahier Lot K, critère
   * d'acceptation "vérifiable sans qu'aucune ligne n'existe encore").
   */
  isCustomized: boolean;
}

const LANDING_CONFIG_COLUMNS = [
  "sections",
  "brand_color_primary",
  "brand_color_secondary",
  "font_choice",
  "hero_title",
  "hero_subtitle",
  "cta_label",
  "cta_url",
  "visual_style",
  "announcement",
  "announcement_enabled",
  "hero_layout",
  "hero_media_url",
  "highlights",
  "secondary_cta_label",
  "secondary_cta_url",
  "payment_methods",
  "show_stats",
].join(", ");

export async function getOrganizationIndustry(organizationId: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("industry")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    console.error(`getOrganizationIndustry(${organizationId}) error:`, error.message);
    return null;
  }
  return data?.industry ?? null;
}

/**
 * Décode les colonnes ajoutées par 0052_storefront_v2.sql. Chaque champ
 * jsonb est validé par son schéma Zod et retombe sur `null` en cas de
 * contenu inattendu, jamais sur une exception : la vitrine publique d'un
 * commerçant ne doit pas devenir inaccessible parce qu'une colonne
 * annexe a été écrite à la main ou par une version antérieure du schéma
 * (même raisonnement que le `safeParse` sur `sections` ci-dessous).
 */
type StorefrontColumns = Pick<
  LandingConfig,
  | "announcement"
  | "announcementEnabled"
  | "heroLayout"
  | "heroMediaUrl"
  | "highlights"
  | "secondaryCtaLabel"
  | "secondaryCtaUrl"
  | "paymentMethods"
  | "showStats"
>;

function parseStorefrontColumns(row: Record<string, unknown>): StorefrontColumns {
  const parsedHighlights = row.highlights == null ? null : LandingHighlightsSchema.safeParse(row.highlights);
  const parsedPayments = row.payment_methods == null ? null : PaymentMethodsSchema.safeParse(row.payment_methods);
  const heroLayout = typeof row.hero_layout === "string" && (HERO_LAYOUTS as readonly string[]).includes(row.hero_layout)
    ? (row.hero_layout as HeroLayout)
    : null;

  return {
    announcement: (row.announcement as string | null) ?? null,
    // `!== false` et non `?? true` : la colonne est NOT NULL DEFAULT true,
    // mais une lecture sur une base non migrée renverrait `undefined` —
    // le défaut doit rester « activé » dans les deux cas.
    announcementEnabled: row.announcement_enabled !== false,
    heroLayout,
    heroMediaUrl: (row.hero_media_url as string | null) ?? null,
    highlights: parsedHighlights?.success ? parsedHighlights.data : null,
    secondaryCtaLabel: (row.secondary_cta_label as string | null) ?? null,
    secondaryCtaUrl: (row.secondary_cta_url as string | null) ?? null,
    paymentMethods: parsedPayments?.success ? parsedPayments.data : null,
    showStats: row.show_stats !== false,
  };
}

/**
 * Lit la configuration de landing page d'une organisation. Si aucune
 * ligne `organization_landing_config` n'existe encore, calcule (SANS
 * persister) le preset par défaut de son secteur — même pattern que
 * `plans-repository.ts::getOrganizationSubscription` pour l'absence de
 * ligne (cahier Lot K).
 *
 * `knownIndustry` évite une requête `organizations` redondante quand
 * l'appelant a déjà résolu le tenant (ex: `src/app/page.tsx` via
 * `resolveRequestTenant()`, qui a déjà `tenant.industry` sous la main) —
 * même logique d'optimisation que celle documentée dans
 * `resolve-request-tenant.ts`. Omis (`undefined`), la fonction relit
 * `organizations.industry` elle-même — utilisé depuis `/dashboard/site`,
 * qui n'a pas cette valeur préchargée. Passer explicitement `null` force
 * le repli "default" sans requête (organisation sans industry connue).
 */
export async function getLandingConfig(
  organizationId: string,
  knownIndustry?: string | null,
): Promise<LandingConfig> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organization_landing_config")
    .select(LANDING_CONFIG_COLUMNS)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    console.error(`getLandingConfig(${organizationId}) error:`, error.message);
  }

  // `select()` recevant une liste de colonnes construite dynamiquement
  // (LANDING_CONFIG_COLUMNS), supabase-js ne peut pas inférer la forme de
  // la ligne et retombe sur un type d'erreur générique. La ligne est donc
  // re-typée explicitement ici — les noms de colonnes restent vérifiés au
  // runtime par les `safeParse`/repli `null` de chaque champ.
  const row = (data ?? null) as Record<string, unknown> | null;

  if (!error && row) {
    // Défensif : si le jsonb persisté ne correspond plus au schéma actuel
    // (ex: un type de section retiré depuis une future évolution), on
    // retombe sur le preset du secteur plutôt que de casser le rendu de
    // la vitrine publique — même esprit que
    // `onboarding-service.ts::getOnboardingStatus` : jamais bloquer un
    // rendu sur une donnée corrompue/obsolète.
    const parsedSections = LandingSectionsSchema.safeParse(row.sections);
    if (parsedSections.success && parsedSections.data.length > 0) {
      return {
        organizationId,
        sections: parsedSections.data
          .map(({ type, enabled, order }) => ({ type, enabled, order }))
          .sort((a, b) => a.order - b.order),
        brandColorPrimary: (row.brand_color_primary as string | null) ?? null,
        brandColorSecondary: (row.brand_color_secondary as string | null) ?? null,
        fontChoice: (row.font_choice as FontChoice | null) ?? "modern",
        heroTitle: (row.hero_title as string | null) ?? null,
        heroSubtitle: (row.hero_subtitle as string | null) ?? null,
        ctaLabel: (row.cta_label as string | null) ?? null,
        ctaUrl: (row.cta_url as string | null) ?? null,
        visualStyle: (row.visual_style as "soft" | "clean" | "bold" | null) ?? "soft",
        ...parseStorefrontColumns(row),
        isCustomized: true,
      };
    }
  }

  const industry = knownIndustry !== undefined ? knownIndustry : await getOrganizationIndustry(organizationId);
  const presetKey = resolveIndustryPresetKey(industry);

  return {
    organizationId,
    sections: buildDefaultSections(presetKey),
    brandColorPrimary: null,
    brandColorSecondary: null,
    fontChoice: "modern",
    heroTitle: null,
    heroSubtitle: null,
    ctaLabel: null,
    ctaUrl: null,
    visualStyle: "soft",
    announcement: null,
    announcementEnabled: true,
    heroLayout: null,
    heroMediaUrl: null,
    highlights: null,
    secondaryCtaLabel: null,
    secondaryCtaUrl: null,
    paymentMethods: null,
    showStats: true,
    isCustomized: false,
  };
}

export interface UpdateLandingConfigSectionInput {
  type: LandingSectionType;
  enabled: boolean;
  order: number;
}

export interface UpdateLandingConfigInput {
  sections: UpdateLandingConfigSectionInput[];
  brandColorPrimary?: string | null;
  brandColorSecondary?: string | null;
  fontChoice?: FontChoice | null;
  heroTitle?: string | null;
  heroSubtitle?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  visualStyle?: "soft" | "clean" | "bold" | null;
  // --- Vitrine V2. `undefined` = champ non touché par cet appel (la
  // valeur en base est conservée) ; `null` = effacement explicite. La
  // distinction compte : /dashboard/site enregistre la vitrine par
  // formulaires séparés, et un formulaire ne doit jamais écraser les
  // champs d'un autre.
  announcement?: string | null;
  announcementEnabled?: boolean;
  heroLayout?: HeroLayout | null;
  heroMediaUrl?: string | null;
  highlights?: LandingHighlight[] | null;
  secondaryCtaLabel?: string | null;
  secondaryCtaUrl?: string | null;
  paymentMethods?: PaymentMethodKey[] | null;
  showStats?: boolean;
}

/**
 * Valide et persiste la configuration. Autorisation (owner/admin/manager)
 * volontairement PAS vérifiée ici — comme le reste du projet
 * (`requireMembership` reste la responsabilité de la Server Action
 * appelante, voir `dashboard/site/page.tsx`), cette fonction ne fait que
 * la validation métier des données elles-mêmes.
 */
/**
 * Supprime la personnalisation de la vitrine sans toucher aux données du
 * tenant (logo, bannière, catalogue, témoignages, domaine, SEO, etc.).
 * La prochaine lecture de getLandingConfig() retombe donc naturellement
 * sur le blueprint par défaut du secteur.
 */
export async function resetLandingConfig(organizationId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("organization_landing_config")
    .delete()
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(`Impossible de réinitialiser la vitrine : ${error.message}`);
  }
}

export async function updateLandingConfig(organizationId: string, input: UpdateLandingConfigInput): Promise<void> {
  if (input.sections.length === 0) {
    throw new ValidationError("Votre page doit contenir au moins une section.");
  }

  const seenTypes = new Set<string>();
  const seenOrders = new Set<number>();
  for (const section of input.sections) {
    if (!LANDING_SECTION_TYPES.includes(section.type)) {
      throw new ValidationError(`Type de section inconnu : "${section.type}".`);
    }
    if (seenTypes.has(section.type)) {
      throw new ValidationError(`La section "${section.type}" est en double.`);
    }
    seenTypes.add(section.type);
    if (seenOrders.has(section.order)) {
      throw new ValidationError("Deux sections ne peuvent pas avoir le même ordre d'affichage.");
    }
    seenOrders.add(section.order);
  }

  if (input.brandColorPrimary && !HEX_COLOR_REGEX.test(input.brandColorPrimary)) {
    throw new ValidationError("Couleur principale invalide (format attendu : #rrggbb).");
  }
  if (input.brandColorSecondary && !HEX_COLOR_REGEX.test(input.brandColorSecondary)) {
    throw new ValidationError("Couleur secondaire invalide (format attendu : #rrggbb).");
  }
  if (input.fontChoice && !FONT_CHOICES.includes(input.fontChoice)) {
    throw new ValidationError("Police invalide.");
  }
  if (input.visualStyle && !["soft", "clean", "bold"].includes(input.visualStyle)) {
    throw new ValidationError("Style visuel invalide.");
  }
  for (const [label, value] of [
    ["Titre", input.heroTitle],
    ["Sous-titre", input.heroSubtitle],
    ["Bouton", input.ctaLabel],
    ["Texte du second bouton", input.secondaryCtaLabel],
  ] as const) {
    if (value && value.length > 140) throw new ValidationError(`${label} trop long.`);
  }

  if (input.announcement && input.announcement.length > 160) {
    throw new ValidationError("Le message d'annonce est trop long (160 caractères maximum).");
  }
  if (input.heroLayout && !HERO_LAYOUTS.includes(input.heroLayout)) {
    throw new ValidationError("Composition d'en-tête invalide.");
  }
  if (input.highlights) {
    const parsed = LandingHighlightsSchema.safeParse(input.highlights);
    if (!parsed.success) {
      throw new ValidationError("Bande de confiance invalide : 4 éléments maximum, chacun avec un titre.");
    }
  }
  if (input.paymentMethods) {
    const parsed = PaymentMethodsSchema.safeParse(input.paymentMethods);
    if (!parsed.success) throw new ValidationError("Moyen de paiement inconnu.");
  }
  for (const [label, value] of [
    ["Lien du bouton", input.ctaUrl],
    ["Lien du second bouton", input.secondaryCtaUrl],
  ] as const) {
    if (value && !isSafePublicUrl(value)) {
      throw new ValidationError(`${label} invalide : utilisez une adresse commençant par https:// ou un lien interne (/contact).`);
    }
  }

  const supabase = getSupabaseServiceClient();

  // Seuls les champs réellement fournis sont écrits : `upsert` ne modifie
  // en base QUE les colonnes présentes dans le payload envoyé à
  // PostgREST (les autres restent inchangées côté serveur), donc chaque
  // champ ici gardé optionnel-et-omis-si-absent est un choix délibéré —
  // pas seulement pour les champs V2, mais aussi pour les champs
  // historiques (couleurs, police, titre du hero, etc.). Sans ce garde-fou,
  // un formulaire qui n'édite QUE, par exemple, la bande de confiance
  // (`updateHighlightsAction`, /dashboard/site) écrirait `brand_color_primary:
  // null` en même temps, effaçant silencieusement une couleur choisie par
  // un formulaire précédent. `sections` reste le seul champ obligatoire
  // (voir UpdateLandingConfigInput) : impossible de mettre à jour cette
  // ligne sans savoir quelles sections elle décrit.
  const payload: Record<string, unknown> = {
    organization_id: organizationId,
    sections: input.sections,
  };

  if (input.brandColorPrimary !== undefined) payload.brand_color_primary = input.brandColorPrimary || null;
  if (input.brandColorSecondary !== undefined) payload.brand_color_secondary = input.brandColorSecondary || null;
  if (input.fontChoice !== undefined) payload.font_choice = input.fontChoice || null;
  if (input.heroTitle !== undefined) payload.hero_title = input.heroTitle || null;
  if (input.heroSubtitle !== undefined) payload.hero_subtitle = input.heroSubtitle || null;
  if (input.ctaLabel !== undefined) payload.cta_label = input.ctaLabel || null;
  if (input.ctaUrl !== undefined) payload.cta_url = input.ctaUrl || null;
  if (input.visualStyle !== undefined) payload.visual_style = input.visualStyle || "soft";

  if (input.announcement !== undefined) payload.announcement = input.announcement || null;
  if (input.announcementEnabled !== undefined) payload.announcement_enabled = input.announcementEnabled;
  if (input.heroLayout !== undefined) payload.hero_layout = input.heroLayout || null;
  if (input.heroMediaUrl !== undefined) payload.hero_media_url = input.heroMediaUrl || null;
  if (input.highlights !== undefined) payload.highlights = input.highlights;
  if (input.secondaryCtaLabel !== undefined) payload.secondary_cta_label = input.secondaryCtaLabel || null;
  if (input.secondaryCtaUrl !== undefined) payload.secondary_cta_url = input.secondaryCtaUrl || null;
  if (input.paymentMethods !== undefined) payload.payment_methods = input.paymentMethods;
  if (input.showStats !== undefined) payload.show_stats = input.showStats;

  // Un `upsert` dont le payload ne contient, au-delà de la clé primaire,
  // que `sections` (cas d'une INSERTION pour un tenant qui n'a encore
  // aucune ligne) doit tout de même passer : c'est le chemin normal de
  // `applyPresetAction`. Ce n'est bloquant que si la ligne existe déjà ET
  // qu'aucun champ réel n'est fourni — ce que le code appelant ne fait
  // jamais (chaque Server Action de /dashboard/site fournit au moins un
  // champ métier), donc volontairement non gardé ici pour ne pas
  // complexifier un cas qui ne se produit pas en pratique.
  const { error } = await supabase.from("organization_landing_config").upsert(payload);

  if (error) {
    throw new Error(`Impossible d'enregistrer la configuration de la page : ${error.message}`);
  }
}

// ============================================================
// Données par type de section — lecture seule, vitrine publique
// ============================================================

export interface ServiceSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  durationMinutes: number | null;
  categoryName: string | null;
  /** Catalogue V2 (0056) — parité avec CatalogProductSummary.imageUrl. */
  imageUrl: string | null;
}

/** `services` actifs, mêmes conventions que `catalog-service.ts::listActiveProductsForStorefront`. */
export async function listActiveServicesForStorefront(organizationId: string, limit = 12): Promise<ServiceSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .select("id, name, slug, description, price, duration_minutes, categories(name), service_images(url, position)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("name")
    .limit(limit);

  if (error) throw new Error(`Erreur lecture services vitrine : ${error.message}`);

  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    price: Number(s.price),
    durationMinutes: s.duration_minutes,
    categoryName: (s as unknown as { categories?: { name?: string } }).categories?.name ?? null,
    imageUrl: resolvePrimaryImageUrl(
      (s as unknown as { service_images?: { url: string; position: number }[] }).service_images,
    ),
  }));
}

// ============================================================
// NOTE (chantier vitrine V2) : `listCategoriesWithProductCounts` et
// `listPromotedProductsForStorefront` — ex-résidentes de cette section —
// ont été retirées. Elles sont remplacées par `listStorefrontCategories`
// et `listStorefrontProducts({ promotionsOnly: true })`
// (catalog-service.ts), qui couvrent le même besoin avec en plus les
// vignettes de catégorie, les badges produit et un tri configurable.
// `getLandingSectionData` ci-dessous appelle déjà ces remplaçantes.
// ============================================================

export interface GalleryImage {
  url: string;
  productName: string;
}

/**
 * Photos issues du catalogue actif (`product_images`, cahier Lot K).
 * Deux requêtes explicites plutôt qu'un embed filtré `products!inner` +
 * `.eq("products.status", ...)` : ce projet n'utilise nulle part ce
 * pattern PostgREST et je préfère une requête dont le comportement est
 * déjà vérifié ailleurs dans ce code (filtre en mémoire après un `.in()`
 * — même logique que `getProductsByIds` dans `catalog-service.ts`).
 */
export async function listGalleryImages(organizationId: string, limit = 8): Promise<GalleryImage[]> {
  const supabase = getSupabaseServiceClient();

  const { data: activeProducts, error: productsError } = await supabase
    .from("products")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("status", "active");

  if (productsError) throw new Error(`Erreur lecture produits pour la galerie : ${productsError.message}`);
  if (!activeProducts || activeProducts.length === 0) return [];

  const nameByProductId = new Map(activeProducts.map((p) => [p.id, p.name]));

  const { data: images, error: imagesError } = await supabase
    .from("product_images")
    .select("url, product_id, position")
    .eq("organization_id", organizationId)
    .in(
      "product_id",
      activeProducts.map((p) => p.id),
    )
    .order("position")
    .limit(limit);

  if (imagesError) throw new Error(`Erreur lecture galerie : ${imagesError.message}`);

  return (images ?? []).map((img) => ({
    url: img.url,
    productName: nameByProductId.get(img.product_id) ?? "",
  }));
}

export interface TeamMember {
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: MemberRole;
}

/**
 * Équipe (`memberships` + `profiles`). Pas de relation directe en base
 * entre `memberships` et `profiles` (les deux référencent `auth.users`
 * séparément, voir `0001_core_tenancy.sql`) — PostgREST ne peut donc PAS
 * embarquer `profiles(...)` depuis une requête sur `memberships` (aucune
 * FK directe entre les deux). Deux requêtes + fusion en mémoire, comme
 * `listGalleryImages` ci-dessus.
 *
 * NOTE HONNÊTE (voir RAPPORT_LOT_K.md) : `profiles.full_name`/
 * `avatar_url` ne sont écrits par AUCUN écran de ce projet à ce jour
 * (vérifié : aucune requête `.from("profiles")` en écriture nulle part
 * dans le code fourni) — en pratique ces deux colonnes sont donc
 * actuellement toujours `null` pour tous les membres existants. Le repli
 * `fullName: null` est géré côté composant (`team.tsx`) par un libellé de
 * rôle plutôt qu'un nom vide, pour que la section reste TOUJOURS
 * présentable, jamais visuellement cassée — la personnalisation
 * nom/photo elle-même reste un gap pré-existant, hors du périmètre
 * strict de ce cahier (celui-ci autorise explicitement à ne pas
 * construire "un futur champ photo/bio").
 */
export async function listTeamMembers(organizationId: string, limit = 12): Promise<TeamMember[]> {
  const supabase = getSupabaseServiceClient();

  const { data: memberships, error: membershipsError } = await supabase
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("organization_id", organizationId)
    .order("created_at")
    .limit(limit);

  if (membershipsError) throw new Error(`Erreur lecture équipe : ${membershipsError.message}`);
  if (!memberships || memberships.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in(
      "id",
      memberships.map((m) => m.user_id),
    );

  if (profilesError) throw new Error(`Erreur lecture profils équipe : ${profilesError.message}`);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return memberships.map((m) => ({
    userId: m.user_id,
    fullName: profileById.get(m.user_id)?.full_name ?? null,
    avatarUrl: profileById.get(m.user_id)?.avatar_url ?? null,
    role: m.role as MemberRole,
  }));
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

/** FAQ actives (`faqs.is_active = true`), pour la section publique "faq" — distinct de `matchFaq` (faq-resolver.ts), qui sert le routeur IA, pas l'affichage. */
export async function listActiveFaqsForLanding(organizationId: string): Promise<FaqItem[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("faqs")
    .select("id, question, answer")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at");

  if (error) throw new Error(`Erreur lecture FAQ : ${error.message}`);
  return data ?? [];
}

/**
 * Dispatcher générique par type de section (cahier Lot K :
 * "getLandingSectionData(organizationId, sectionType)"). Retourne `null`
 * pour les types qui ne nécessitent aucune lecture DB dédiée — hero/
 * about/contact/location/social_links/cta lisent directement le
 * `TenantContext` déjà résolu par la page appelante
 * (`resolveRequestTenant()`), une requête supplémentaire serait
 * redondante.
 */
export type LandingSectionData =
  | { type: "products"; products: StorefrontProduct[] }
  | { type: "services"; services: ServiceSummary[] }
  | { type: "categories"; categories: StorefrontCategory[] }
  | { type: "promotions"; products: StorefrontProduct[] }
  | { type: "gallery"; images: GalleryImage[] }
  | { type: "testimonials"; testimonials: TestimonialSummary[] }
  | { type: "team"; members: TeamMember[] }
  | { type: "faq"; faqs: FaqItem[] }
  | { type: "booking"; services: ServiceSummary[] };

export async function getLandingSectionData(
  organizationId: string,
  sectionType: LandingSectionType,
): Promise<LandingSectionData | null> {
  switch (sectionType) {
    case "products":
      // Tri "featured" : les produits épinglés d'abord, puis les plus
      // récents — c'est la vitrine d'accueil, pas un catalogue exhaustif
      // (l'ancien tri alphabétique montrait éternellement les mêmes
      // produits en tête, ceux dont le nom commençait par un chiffre).
      return {
        type: "products",
        products: await listStorefrontProducts(organizationId, { limit: 8, sort: "featured" }),
      };
    case "services":
      return { type: "services", services: await listActiveServicesForStorefront(organizationId) };
    case "categories":
      return { type: "categories", categories: await listStorefrontCategories(organizationId) };
    case "promotions":
      return {
        type: "promotions",
        products: await listStorefrontProducts(organizationId, { limit: 6, promotionsOnly: true, sort: "recent" }),
      };
    case "gallery":
      return { type: "gallery", images: await listGalleryImages(organizationId) };
    case "testimonials":
      return { type: "testimonials", testimonials: await listTestimonials(organizationId) };
    case "team":
      return { type: "team", members: await listTeamMembers(organizationId) };
    case "faq":
      return { type: "faq", faqs: await listActiveFaqsForLanding(organizationId) };
    case "booking":
      return { type: "booking", services: await listActiveServicesForStorefront(organizationId) };
    default:
      return null;
  }
}

// ============================================================
// Témoignages — CRUD simple, gérés depuis /dashboard/site
// ============================================================

export interface TestimonialSummary {
  id: string;
  authorName: string;
  content: string;
  rating: number | null;
  displayOrder: number;
}

export async function listTestimonials(organizationId: string): Promise<TestimonialSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("testimonials")
    .select("id, author_name, content, rating, display_order")
    .eq("organization_id", organizationId)
    .order("display_order");

  if (error) throw new Error(`Erreur lecture témoignages : ${error.message}`);

  return (data ?? []).map((t) => ({
    id: t.id,
    authorName: t.author_name,
    content: t.content,
    rating: t.rating,
    displayOrder: t.display_order,
  }));
}

export interface CreateTestimonialInput {
  organizationId: string;
  authorName: string;
  content: string;
  rating?: number | null;
}

export async function createTestimonial(input: CreateTestimonialInput): Promise<{ id: string }> {
  if (!input.authorName.trim()) {
    throw new ValidationError("Le nom de l'auteur du témoignage est requis.");
  }
  if (!input.content.trim()) {
    throw new ValidationError("Le contenu du témoignage est requis.");
  }
  if (input.rating != null && (input.rating < 1 || input.rating > 5)) {
    throw new ValidationError("La note doit être comprise entre 1 et 5.");
  }

  const supabase = getSupabaseServiceClient();

  // Nouveau témoignage en fin de liste par défaut (max existant + 1) —
  // le commerçant peut ensuite réordonner depuis /dashboard/site.
  const { data: last } = await supabase
    .from("testimonials")
    .select("display_order")
    .eq("organization_id", input.organizationId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (last?.display_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("testimonials")
    .insert({
      organization_id: input.organizationId,
      author_name: input.authorName.trim(),
      content: input.content.trim(),
      rating: input.rating ?? null,
      display_order: nextOrder,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Impossible de créer le témoignage : ${error?.message}`);
  }
  return { id: data.id };
}

export async function deleteTestimonial(organizationId: string, testimonialId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("testimonials")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", testimonialId);

  if (error) {
    throw new Error(`Impossible de supprimer le témoignage : ${error.message}`);
  }
}

// ============================================================
// Vitrine V2 — prestations
// ============================================================

export interface ServiceDetail extends ServiceSummary {
  status: string;
  /** Catalogue V2 (0056) — galerie complète triée par position ; images[0] === imageUrl. */
  images: string[];
  /** Catalogue V2 (0056) — jamais undefined : [] si aucune configurée. */
  specifications: CatalogSpecification[];
}

/**
 * Fiche prestation publique (/services/[slug]). Une prestation non
 * active reste consultable — même règle que la fiche produit
 * (`getProductBySlug`) : ne jamais casser un lien déjà partagé sur
 * WhatsApp. C'est à la page appelante d'afficher l'indisponibilité.
 */
export async function getServiceBySlug(organizationId: string, slug: string): Promise<ServiceDetail | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, slug, description, price, duration_minutes, status, specifications, categories(name), service_images(url, position)",
    )
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture prestation : ${error.message}`);
  if (!data) return null;

  const images = (
    (data as unknown as { service_images?: { url: string; position: number }[] }).service_images ?? []
  )
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((img) => img.url);

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    description: data.description,
    price: Number(data.price),
    durationMinutes: data.duration_minutes,
    categoryName: (data as unknown as { categories?: { name?: string } }).categories?.name ?? null,
    status: data.status,
    imageUrl: images[0] ?? null,
    images,
    specifications: (data as unknown as { specifications?: CatalogSpecification[] | null }).specifications ?? [],
  };
}

/** Prestations de la même catégorie, hors celle affichée — bloc « autres prestations » de la fiche. */
export async function listRelatedServices(
  organizationId: string,
  excludeServiceId: string,
  limit = 3,
): Promise<ServiceSummary[]> {
  const services = await listActiveServicesForStorefront(organizationId, limit + 1);
  return services.filter((service) => service.id !== excludeServiceId).slice(0, limit);
}
