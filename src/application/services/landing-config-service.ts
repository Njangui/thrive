import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError } from "@/lib/errors";
import type { MemberRole } from "./auth-service";
import { listActiveProductsForStorefront, type CatalogProductSummary } from "./catalog-service";
import {
  LANDING_SECTION_TYPES,
  LandingSectionsSchema,
  FONT_CHOICES,
  HEX_COLOR_REGEX,
  type LandingSectionType,
  type FontChoice,
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
  /**
   * `false` = aucune ligne `organization_landing_config` n'existe encore
   * pour cette organisation : `sections` reflète le preset calculé de son
   * secteur, rien n'a encore été persisté (cahier Lot K, critère
   * d'acceptation "vérifiable sans qu'aucune ligne n'existe encore").
   */
  isCustomized: boolean;
}

async function getOrganizationIndustry(organizationId: string): Promise<string | null> {
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
    .select("sections, brand_color_primary, brand_color_secondary, font_choice")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    console.error(`getLandingConfig(${organizationId}) error:`, error.message);
  }

  if (!error && data) {
    // Défensif : si le jsonb persisté ne correspond plus au schéma actuel
    // (ex: un type de section retiré depuis une future évolution), on
    // retombe sur le preset du secteur plutôt que de casser le rendu de
    // la vitrine publique — même esprit que
    // `onboarding-service.ts::getOnboardingStatus` : jamais bloquer un
    // rendu sur une donnée corrompue/obsolète.
    const parsedSections = LandingSectionsSchema.safeParse(data.sections);
    if (parsedSections.success && parsedSections.data.length > 0) {
      return {
        organizationId,
        sections: parsedSections.data
          .map(({ type, enabled, order }) => ({ type, enabled, order }))
          .sort((a, b) => a.order - b.order),
        brandColorPrimary: data.brand_color_primary,
        brandColorSecondary: data.brand_color_secondary,
        fontChoice: (data.font_choice as FontChoice | null) ?? "modern",
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
}

/**
 * Valide et persiste la configuration. Autorisation (owner/admin/manager)
 * volontairement PAS vérifiée ici — comme le reste du projet
 * (`requireMembership` reste la responsabilité de la Server Action
 * appelante, voir `dashboard/site/page.tsx`), cette fonction ne fait que
 * la validation métier des données elles-mêmes.
 */
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

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("organization_landing_config").upsert({
    organization_id: organizationId,
    sections: input.sections,
    brand_color_primary: input.brandColorPrimary || null,
    brand_color_secondary: input.brandColorSecondary || null,
    font_choice: input.fontChoice || null,
  });

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
}

/** `services` actifs, mêmes conventions que `catalog-service.ts::listActiveProductsForStorefront`. */
export async function listActiveServicesForStorefront(organizationId: string, limit = 12): Promise<ServiceSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .select("id, name, slug, description, price, duration_minutes, categories(name)")
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
  }));
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  productCount: number;
}

/**
 * Catégories ayant au moins un produit actif, avec leur compte — jamais
 * une catégorie vide (éviterait une vignette qui mène à un catalogue
 * filtré vide, section "critères d'acceptation" du mandat de vague : pas
 * de rendu décoratif/cassé). Calcul du compte en mémoire (2 requêtes
 * simples) plutôt qu'un agrégat PostgREST `products(count)` — cohérent
 * avec le reste du projet, qui n'utilise nulle part cette syntaxe
 * d'agrégat embarqué et privilégie des requêtes explicites vérifiables.
 */
export async function listCategoriesWithProductCounts(organizationId: string): Promise<CategorySummary[]> {
  const supabase = getSupabaseServiceClient();

  const [{ data: categories, error: categoriesError }, { data: products, error: productsError }] = await Promise.all([
    supabase.from("categories").select("id, name, slug").eq("organization_id", organizationId).order("name"),
    supabase
      .from("products")
      .select("category_id")
      .eq("organization_id", organizationId)
      .eq("status", "active"),
  ]);

  if (categoriesError) throw new Error(`Erreur lecture catégories : ${categoriesError.message}`);
  if (productsError) throw new Error(`Erreur comptage produits par catégorie : ${productsError.message}`);

  const counts = new Map<string, number>();
  for (const product of products ?? []) {
    if (!product.category_id) continue;
    counts.set(product.category_id, (counts.get(product.category_id) ?? 0) + 1);
  }

  return (categories ?? [])
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug, productCount: counts.get(c.id) ?? 0 }))
    .filter((c) => c.productCount > 0);
}

export interface PromotedProduct extends CatalogProductSummary {
  compareAtPrice: number;
}

/**
 * Produits en promotion (`compare_at_price > unit_price`, même définition
 * que la page produit publique, `src/app/produits/[slug]/page.tsx`).
 * Comparaison de deux COLONNES : PostgREST ne le permet pas nativement
 * via le query builder fluide (seulement colonne vs valeur littérale) —
 * sur-échantillonne donc les produits ayant un `compare_at_price` défini
 * puis filtre/tronque en mémoire. Pour un widget vitrine de quelques
 * produits vedettes (pas une liste paginée exhaustive), c'est un
 * compromis honnête plutôt qu'une fonction SQL dédiée non demandée par
 * le cahier.
 */
export async function listPromotedProductsForStorefront(organizationId: string, limit = 6): Promise<PromotedProduct[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, slug, unit_price, compare_at_price, description, categories(name)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .not("compare_at_price", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit * 4);

  if (error) throw new Error(`Erreur lecture promotions : ${error.message}`);

  return (data ?? [])
    .map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      unitPrice: Number(p.unit_price),
      compareAtPrice: Number(p.compare_at_price),
      description: p.description,
      categoryName: (p as unknown as { categories?: { name?: string } }).categories?.name ?? null,
    }))
    .filter((p) => p.compareAtPrice > p.unitPrice)
    .slice(0, limit);
}

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
  | { type: "products"; products: CatalogProductSummary[] }
  | { type: "services"; services: ServiceSummary[] }
  | { type: "categories"; categories: CategorySummary[] }
  | { type: "promotions"; products: PromotedProduct[] }
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
      return { type: "products", products: await listActiveProductsForStorefront(organizationId, { limit: 6 }) };
    case "services":
      return { type: "services", services: await listActiveServicesForStorefront(organizationId) };
    case "categories":
      return { type: "categories", categories: await listCategoriesWithProductCounts(organizationId) };
    case "promotions":
      return { type: "promotions", products: await listPromotedProductsForStorefront(organizationId) };
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
