import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { canUseFeature } from "./entitlements-service";
import { pauseScheduledPostsForProduct } from "./marketing-service";
import { notifyOrgAdmins } from "./notification-service";
import { slugify, CatalogSpecificationsSchema, type CatalogSpecification } from "@/domain/entities/catalog";
import { NotFoundError, ValidationError, QuotaExceededError } from "@/lib/errors";

export interface CatalogProductSummary {
  id: string;
  name: string;
  slug: string | null;
  unitPrice: number;
  description: string | null;
  categoryName: string | null;
  /**
   * Lot 3 (audit master prompt §28/§35) — URL de l'image principale
   * (position la plus basse dans product_images), ou `null` si le
   * produit n'a aucune image. Alimente `attachmentUrl` côté messagerie
   * (conversation-orchestrator.ts) et diffusion de groupe
   * (whatsapp-group-service.ts).
   */
  imageUrl: string | null;
}

/** Image de position la plus basse (principale) — ou null si aucune. Partagé entre toutes les requêtes catalogue pour ne pas dupliquer ce tri (section 100). */
export function resolvePrimaryImageUrl(images: { url: string; position: number }[] | null | undefined): string | null {
  if (!images || images.length === 0) return null;
  return [...images].sort((a, b) => a.position - b.position)[0]!.url;
}

/** Forme de retour de `adjust_product_stock()` — voir 0038_atomic_order_stock_transaction.sql. */
interface AdjustProductStockRow {
  new_stock: number;
  new_status: string;
  previous_status: string;
  product_name: string;
}

/**
 * Résout une catégorie par nom (insensible à la casse via le slug), la
 * crée si elle n'existe pas encore. Partagé entre l'import CSV et la
 * création manuelle de produit (section 68 : une source de données, pas
 * de logique dupliquée).
 */
export async function findOrCreateCategory(organizationId: string, name: string): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const slug = slugify(name);

  const { data: existing } = await supabase
    .from("categories")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("categories")
    .insert({ organization_id: organizationId, name: name.trim(), slug })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Impossible de créer/trouver la catégorie "${name}": ${error?.message}`);
  }
  return created.id;
}

export interface CategorySummary {
  id: string;
  name: string;
}

/**
 * Catégories réellement gérées comme une liste fermée (section : "les
 * catégories doivent être sélectionnées selon le secteur d'activité, pas
 * retapées à chaque produit — sinon 'chaussure' et 'Chaussure' coexistent").
 * `listCategories` alimente les `<select>` de création produit/service ;
 * plus aucun de ces formulaires ne doit passer par `findOrCreateCategory`
 * avec du texte libre (le CSV d'import reste le seul appelant légitime de
 * `findOrCreateCategory` — une colonne de tableur n'a pas de `<select>`).
 */
export async function listCategories(organizationId: string): Promise<CategorySummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("categories")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  return (data ?? []) as CategorySummary[];
}

/** Création explicite (bouton "+ Nouvelle catégorie"), distincte de
 * `findOrCreateCategory` : celle-ci renvoie une erreur claire si le nom
 * existe déjà plutôt que de renvoyer silencieusement l'id existant — un
 * marchand qui clique "créer" veut savoir si ça a doublonné. */
export async function createCategory(organizationId: string, name: string): Promise<CategorySummary> {
  const supabase = getSupabaseServiceClient();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Le nom de la catégorie est requis.");
  const slug = slugify(trimmed);

  const { data: existing } = await supabase
    .from("categories")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .maybeSingle();
  if (existing) throw new Error(`La catégorie "${trimmed}" existe déjà.`);

  const { data, error } = await supabase
    .from("categories")
    .insert({ organization_id: organizationId, name: trimmed, slug })
    .select("id, name")
    .single();
  if (error || !data) throw new Error(`Impossible de créer la catégorie : ${error?.message}`);
  return data as CategorySummary;
}

export async function renameCategory(organizationId: string, categoryId: string, name: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Le nom de la catégorie est requis.");
  const { error } = await supabase
    .from("categories")
    .update({ name: trimmed, slug: slugify(trimmed) })
    .eq("id", categoryId)
    .eq("organization_id", organizationId);
  if (error) throw new Error(`Impossible de renommer la catégorie : ${error.message}`);
}

/** Détache d'abord les produits/services de cette catégorie (repasse à
 * "sans catégorie") plutôt que de bloquer sur la contrainte de clé
 * étrangère ou de les supprimer en cascade — perdre la catégorie d'un
 * produit est un détail, perdre le produit lui-même ne l'est pas. */
export async function deleteCategory(organizationId: string, categoryId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  await supabase.from("products").update({ category_id: null }).eq("organization_id", organizationId).eq("category_id", categoryId);
  await supabase.from("services").update({ category_id: null }).eq("organization_id", organizationId).eq("category_id", categoryId);
  const { error } = await supabase.from("categories").delete().eq("id", categoryId).eq("organization_id", organizationId);
  if (error) throw new Error(`Impossible de supprimer la catégorie : ${error.message}`);
}

/**
 * Pré-remplit les catégories d'une organisation à partir du secteur
 * d'activité choisi à l'onboarding (`INDUSTRY_CATEGORY_PRESETS`) — appelé
 * une fois à la création de l'organisation (`onboarding-service.ts`,
 * même moment que le seed de `tenant_modules`). N'écrase jamais des
 * catégories existantes : si l'organisation en a déjà (import CSV avant
 * la fin de l'onboarding, ou ré-appel accidentel), ne fait rien.
 */
export async function seedDefaultCategories(organizationId: string, industry: string | null): Promise<void> {
  const { INDUSTRY_CATEGORY_PRESETS, DEFAULT_CATEGORY_PRESET } = await import("@/application/config/categories");
  const supabase = getSupabaseServiceClient();

  const { count } = await supabase
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if ((count ?? 0) > 0) return;

  const preset = (industry && INDUSTRY_CATEGORY_PRESETS[industry]) || DEFAULT_CATEGORY_PRESET;
  const rows = preset.map((name) => ({ organization_id: organizationId, name, slug: slugify(name) }));
  await supabase.from("categories").insert(rows);
}

/**
 * Récupère les produits ACTIFS pour un discovery WhatsApp (section 15).
 * Ne renvoie jamais un produit OUT_OF_STOCK/DRAFT/INACTIVE — le statut est
 * la seule source de vérité sur la disponibilité (section 10).
 */
export async function getActiveProducts(
  organizationId: string,
  limit = 3,
): Promise<CatalogProductSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, slug, unit_price, description, categories(name), product_images(url, position)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Erreur lecture catalogue: ${error.message}`);
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    unitPrice: Number(p.unit_price),
    description: p.description,
    categoryName: (p as unknown as { categories?: { name?: string } }).categories?.name ?? null,
    imageUrl: resolvePrimaryImageUrl((p as unknown as { product_images?: { url: string; position: number }[] }).product_images),
  }));
}

export interface CatalogProductDetail extends CatalogProductSummary {
  compareAtPrice: number | null;
  /** Catalogue V2, itération 2 (0057) — échéance optionnelle de la promotion en cours ; `null` = pas de compte à rebours. */
  promotionEndsAt: string | null;
  currentStock: number;
  status: string;
  images: string[];
  /** Lot H, Partie 1 — repli géré par src/lib/seo.ts::resolveProductSeo, pas ici. */
  seoTitle: string | null;
  seoDescription: string | null;
  /** Catalogue V2 (0056) — jamais undefined : [] si aucune configurée, voir migration. */
  specifications: CatalogSpecification[];
}

/** Une promotion SANS échéance reste "en promotion" indéfiniment (comportement historique) ; AVEC échéance, seulement tant qu'elle n'est pas dépassée. Détermine le prix barré ET le compte à rebours affichés (voir getProductBySlug/listStorefrontProducts) — la seule porte d'entrée de cette règle, jamais redérivée ailleurs. Exportée pour `storefront-service.ts::getStorefrontCapabilities` (visibilité du lien « Promotions », sitemap) : sans cela, ce décompte aurait continué de voir une promotion expirée. */
export function isPromotionCurrentlyOn(compareAtPrice: number | null, unitPrice: number, promotionEndsAt: string | null): boolean {
  if (compareAtPrice == null || compareAtPrice <= unitPrice) return false;
  if (!promotionEndsAt) return true;
  const deadline = Date.parse(promotionEndsAt);
  return Number.isNaN(deadline) || deadline > Date.now();
}

/** Total de produits actifs pour la pagination de la vitrine publique (voir listActiveProductsForStorefront). */
export async function countActiveProducts(organizationId: string, categoryId?: string): Promise<number> {
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "active");

  if (categoryId) {
    query = query.eq("category_id", categoryId);
  }

  const { count, error } = await query;

  if (error) throw new Error(`Erreur comptage vitrine catalogue: ${error.message}`);
  return count ?? 0;
}

/**
 * Résout une catégorie publique par son slug (Lot K, filtre
 * /produits?category=<slug> depuis la section landing "categories") — ne
 * renvoie que le strict nécessaire pour filtrer + afficher un fil
 * d'Ariane, pas l'entité complète.
 */
export async function getCategoryBySlug(
  organizationId: string,
  slug: string,
): Promise<{ id: string; name: string } | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture catégorie ${slug}: ${error.message}`);
  return data;
}

/**
 * Vitrine publique (section 12). Accepte un `limit`/`offset` optionnels
 * pour permettre au chemin d'appel de ne récupérer que ce dont il a
 * besoin — voir OPTIMISATION ci-dessous. Sans options, comportement
 * identique à avant (tous les produits actifs, triés par nom).
 *
 * OPTIMISATION : `src/app/page.tsx` (page d'accueil publique de chaque
 * tenant) appelait cette fonction SANS limite puis faisait
 * `.slice(0, 6)` en mémoire pour n'afficher que 6 produits vedettes —
 * ramenant potentiellement 100+ lignes (avec description et jointure
 * catégorie) sur chaque chargement de la page la plus visitée de toute
 * la plateforme, pour n'en garder que 6. `src/app/produits/page.tsx`
 * (catalogue complet) n'avait, lui, aucune pagination du tout — même
 * écart que `/dashboard/products` avant sa propre pagination, mais côté
 * public cette fois (plus grande exposition encore).
 */
/**
 * Résumé produit + photo principale — utilisé UNIQUEMENT par la vitrine
 * publique (`listActiveProductsForStorefront` ci-dessous). Type dédié
 * plutôt qu'un champ ajouté à `CatalogProductSummary` : ce type partagé
 * est aussi construit par `getActiveProducts`/`searchProductsByName`/
 * `getProductsByIds` (discovery WhatsApp/IA, mémoire conversationnelle) —
 * les laisser inchangés ici évite tout effet de bord sur ce périmètre
 * pendant qu'il est travaillé ailleurs.
 */
/**
 * Redondant avec `CatalogProductSummary` depuis que `imageUrl` a été
 * remonté sur l'interface de base (Lot 3, pour l'attacher aux résultats
 * de messagerie/diffusion aussi) — gardé comme alias plutôt que
 * supprimé pour ne pas casser les imports existants
 * (`landing-sections/products.tsx`, `product-card.tsx`).
 */
export type StorefrontProductSummary = CatalogProductSummary;

export async function listActiveProductsForStorefront(
  organizationId: string,
  options?: { limit?: number; offset?: number; categoryId?: string },
): Promise<StorefrontProductSummary[]> {
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("products")
    .select("id, name, slug, unit_price, description, categories(name), product_images(url, position)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("name");

  // Lot K : filtre optionnel par catégorie, utilisé à la fois par
  // /produits?category=<slug> (lien "voir tout" de la section landing
  // "categories") et potentiellement par un futur appelant — voir
  // getCategoryBySlug ci-dessous pour la résolution slug -> id.
  if (options?.categoryId) {
    query = query.eq("category_id", options.categoryId);
  }

  if (options?.limit !== undefined) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Erreur lecture vitrine catalogue: ${error.message}`);

  return (data ?? []).map((p) => {
    const images = (p as unknown as { product_images?: { url: string; position: number }[] }).product_images ?? [];
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      unitPrice: Number(p.unit_price),
      description: p.description,
      categoryName: (p as unknown as { categories?: { name?: string } }).categories?.name ?? null,
      imageUrl: resolvePrimaryImageUrl(images),
    };
  });
}

/**
 * Page produit publique (section 12). Un produit non-actif reste
 * consultable (pour ne pas casser un lien déjà partagé, section 40) mais
 * le rendu doit indiquer clairement l'indisponibilité — c'est à la page
 * appelante de vérifier `status`.
 */
export async function getProductBySlug(
  organizationId: string,
  slug: string,
): Promise<CatalogProductDetail | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, slug, unit_price, compare_at_price, promotion_ends_at, current_stock, status, description, seo_title, seo_description, specifications, categories(name), product_images(url, position)",
    )
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture produit ${slug}: ${error.message}`);
  if (!data) return null;

  const images = ((data as unknown as { product_images?: { url: string; position: number }[] })
    .product_images ?? [])
    .sort((a, b) => a.position - b.position)
    .map((img) => img.url);

  const unitPrice = Number(data.unit_price);
  const rawCompareAtPrice = data.compare_at_price ? Number(data.compare_at_price) : null;
  const rawPromotionEndsAt = (data as unknown as { promotion_ends_at?: string | null }).promotion_ends_at ?? null;
  // Effectif, pas brut : une promotion dont l'échéance est dépassée cesse
  // d'être affichée comme telle sur la fiche publique — voir
  // isPromotionCurrentlyOn ci-dessus et le commentaire de la migration
  // 0057. La valeur brute reste consultable côté dashboard (getProductForEdit).
  const promotionOn = isPromotionCurrentlyOn(rawCompareAtPrice, unitPrice, rawPromotionEndsAt);

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    unitPrice,
    compareAtPrice: promotionOn ? rawCompareAtPrice : null,
    promotionEndsAt: promotionOn ? rawPromotionEndsAt : null,
    currentStock: Number(data.current_stock),
    status: data.status,
    description: data.description,
    seoTitle: data.seo_title,
    seoDescription: data.seo_description,
    categoryName: (data as unknown as { categories?: { name?: string } }).categories?.name ?? null,
    imageUrl: images[0] ?? null,
    images,
    specifications: (data as unknown as { specifications?: CatalogSpecification[] | null }).specifications ?? [],
  };
}

/**
 * Recherche simple par nom (PRODUCT_QUERY, section 17). Reste
 * volontairement basique (ilike) — pas de recherche sémantique en V1,
 * conforme à la règle "règles avant IA" (section 45).
 */
export async function searchProductsByName(
  organizationId: string,
  query: string,
  limit = 5,
): Promise<CatalogProductSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, slug, unit_price, description, categories(name), product_images(url, position)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .ilike("name", `%${query}%`)
    .limit(limit);

  if (error) throw new Error(`Erreur recherche catalogue: ${error.message}`);

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    unitPrice: Number(p.unit_price),
    description: p.description,
    categoryName: (p as unknown as { categories?: { name?: string } }).categories?.name ?? null,
    imageUrl: resolvePrimaryImageUrl((p as unknown as { product_images?: { url: string; position: number }[] }).product_images),
  }));
}

/**
 * Résout un lot de produits par id (Lot D, mémoire conversationnelle) —
 * utilisé pour retrouver nom/prix/description des derniers produits
 * mentionnés dans une conversation, sans dépendre de leur statut actuel
 * (un produit mentionné puis passé en rupture doit rester résolvable).
 */
export async function getProductsByIds(
  organizationId: string,
  productIds: string[],
): Promise<CatalogProductSummary[]> {
  if (productIds.length === 0) return [];

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, slug, unit_price, description, categories(name), product_images(url, position)")
    .eq("organization_id", organizationId)
    .in("id", productIds);

  if (error) throw new Error(`Erreur lecture produits par id: ${error.message}`);

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    unitPrice: Number(p.unit_price),
    description: p.description,
    categoryName: (p as unknown as { categories?: { name?: string } }).categories?.name ?? null,
    imageUrl: resolvePrimaryImageUrl((p as unknown as { product_images?: { url: string; position: number }[] }).product_images),
  }));
}

/**
 * Construit le message WhatsApp de présentation catalogue — reprend le
 * format donné en exemple section 15 du doc 2. Le lien pointe vers la
 * landing produit (`/produits/:slug`, section 12) — la landing elle-même
 * arrive dans le bloc suivant (voir docs/GAP_ANALYSIS.md, section P).
 */
export function formatProductDiscoveryMessage(
  products: CatalogProductSummary[],
  publicBaseUrl: string,
  catalogUrl: string,
): string {
  if (products.length === 0) {
    return "Nous mettons actuellement notre catalogue à jour — revenez très vite, ou dites-nous ce que vous cherchez !";
  }

  const lines = ["👋 Bien sûr ! Voici quelques-uns de nos produits disponibles :", ""];

  for (const p of products) {
    lines.push(p.name);
    lines.push(`${p.unitPrice.toLocaleString("fr-FR")} FCFA`);
    if (p.categoryName) lines.push(p.categoryName);
    if (p.description) lines.push(p.description);
    if (p.slug) lines.push(`${publicBaseUrl}/produits/${p.slug}`);
    lines.push("");
  }

  lines.push(`Voir tous les produits : ${catalogUrl}`);
  return lines.join("\n");
}

/**
 * Décrémente le stock (vente/commande) et bascule automatiquement le
 * statut vers OUT_OF_STOCK quand le stock atteint 0 (section 10). Ne
 * supprime jamais rien — l'historique du mouvement est conservé.
 *
 * Lot 1 — l'ajustement de stock lui-même (`current_stock` + `status`)
 * passe désormais par `adjust_product_stock()`, la même fonction SQL
 * atomique (verrouillage de ligne `FOR UPDATE`) que `complete_order_transaction()`
 * utilise en interne pour chaque article d'une commande — une seule
 * source de vérité pour ce calcul, plus le read-then-write en mémoire
 * applicative d'avant (deux décréments concurrents sur le même produit
 * ne se marchaient pas dessus auparavant que si on avait de la chance).
 * Voir 0038_atomic_order_stock_transaction.sql. Le reste (notification,
 * pause des publications, mouvement d'inventaire) reste ici : ce sont
 * des effets de bord hors du calcul de stock lui-même.
 */
export async function decrementStock(
  organizationId: string,
  productId: string,
  quantity: number,
  reason: string,
  actorUserId?: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase.rpc("adjust_product_stock", {
    p_product_id: productId,
    p_organization_id: organizationId,
    p_delta: -quantity,
  });

  if (error) {
    if (error.code === "P0002") {
      throw new Error(`Produit introuvable pour décrément de stock: ${productId}`);
    }
    throw new Error(`Impossible de mettre à jour le stock du produit ${productId}: ${error.message}`);
  }

  const result = (data as AdjustProductStockRow[] | null)?.[0];
  if (!result) {
    throw new Error(`Produit introuvable pour décrément de stock: ${productId}`);
  }

  // Section 52 doc 2 : le flip vers OUT_OF_STOCK doit mettre en pause les
  // publications sociales déjà programmées pour ce produit.
  if (result.new_status === "out_of_stock" && result.previous_status !== "out_of_stock") {
    await pauseScheduledPostsForProduct(organizationId, productId);
    await notifyOrgAdmins({
      organizationId,
      title: "Produit en rupture de stock.",
      body: `Le produit "${result.product_name}" est en rupture de stock.`,
      relatedEntityType: "product",
      relatedEntityId: productId,
    });
  }

  await supabase.from("inventory_movements").insert({
    organization_id: organizationId,
    product_id: productId,
    movement_type: "out",
    quantity,
    reason,
    created_by: actorUserId,
  });
}

/**
 * Réapprovisionnement — peut faire repasser un produit OUT_OF_STOCK à
 * ACTIVE (section 10 : "Lorsque le produit est réapprovisionné : stock > 0,
 * il peut redevenir ACTIVE"). Ne force PAS active si le produit était
 * volontairement `inactive` ou encore `draft`.
 *
 * Lot 1 — même primitif atomique que `decrementStock` (delta positif),
 * voir son commentaire ci-dessus.
 */
export async function restockProduct(
  organizationId: string,
  productId: string,
  quantity: number,
  actorUserId?: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase.rpc("adjust_product_stock", {
    p_product_id: productId,
    p_organization_id: organizationId,
    p_delta: quantity,
  });

  if (error) {
    if (error.code === "P0002") {
      throw new Error(`Produit introuvable pour réapprovisionnement: ${productId}`);
    }
    throw new Error(`Impossible de mettre à jour le stock du produit ${productId}: ${error.message}`);
  }

  const result = (data as AdjustProductStockRow[] | null)?.[0];
  if (!result) {
    throw new Error(`Produit introuvable pour réapprovisionnement: ${productId}`);
  }

  await supabase.from("inventory_movements").insert({
    organization_id: organizationId,
    product_id: productId,
    movement_type: "in",
    quantity,
    reason: "Réapprovisionnement",
    created_by: actorUserId,
  });
}

export interface CreateProductInput {
  organizationId: string;
  name: string;
  description?: string;
  /** Réservé à l'import CSV (colonne texte libre, pas de `<select>`
   * possible sur un tableur) — voir `findOrCreateCategory`. Les
   * formulaires dashboard doivent utiliser `categoryId` ci-dessous. */
  categoryName?: string;
  /** Id d'une catégorie existante, choisie dans le `<select>` du
   * formulaire (section : catégories par secteur, pas retapées à
   * chaque produit). Prioritaire sur `categoryName` si les deux sont
   * fournis. */
  categoryId?: string;
  unitPrice: number;
  currentStock?: number;
  status?: "draft" | "active" | "out_of_stock" | "inactive";
  /** URL finale de l'image (déjà résolue — upload ou lien direct, voir media-service.ts). */
  imageUrl?: string;
  /**
   * Prix barré ("avant promotion") — doit être strictement supérieur à
   * `unitPrice` pour avoir un sens (sinon ignoré silencieusement, jamais
   * une promotion à l'envers affichée à un client). Alimente directement
   * la section "Promotions" de la landing publique
   * (landing-config-service.ts::listPromotedProductsForStorefront) et la
   * page produit — jusqu'ici jamais réglable depuis aucune UI.
   */
  compareAtPrice?: number | null;
  /**
   * Échéance optionnelle de la promotion (compare_at_price) — catalogue V2,
   * itération 2 (0057). Ignorée si `compareAtPrice` ne donne finalement
   * aucune promotion réelle (voir normalisation ci-dessous) : une
   * échéance sans promotion n'aurait aucun sens à afficher.
   */
  promotionEndsAt?: string | null;
}

/** Création manuelle depuis le dashboard (section 50) — même chemin de données que l'import CSV. */
export async function createProduct(input: CreateProductInput): Promise<{ productId: string; slug: string }> {
  const entitlement = await canUseFeature(input.organizationId, "catalog_products", 1);
  if (!entitlement.allowed) {
    throw new QuotaExceededError(`Votre catalogue a atteint la limite de ${entitlement.limit.toLocaleString("fr-FR")} produits de votre offre.`);
  }

  const supabase = getSupabaseServiceClient();

  const categoryId =
    input.categoryId !== undefined
      ? input.categoryId || null
      : input.categoryName
        ? await findOrCreateCategory(input.organizationId, input.categoryName)
        : null;
  const slug = `${slugify(input.name)}-${Math.random().toString(36).slice(2, 7)}`;
  const stock = input.currentStock ?? 0;
  const status = input.status ?? (stock > 0 ? "active" : "draft");
  const compareAtPrice =
    input.compareAtPrice && input.compareAtPrice > input.unitPrice ? input.compareAtPrice : null;
  // Jamais une échéance orpheline : sans promotion réelle, une date de fin
  // n'a rien à clôturer (voir le commentaire de CreateProductInput).
  const promotionEndsAt = compareAtPrice ? (input.promotionEndsAt ?? null) : null;

  const { data, error } = await supabase
    .from("products")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      slug,
      description: input.description ?? null,
      category_id: categoryId,
      unit_price: input.unitPrice,
      compare_at_price: compareAtPrice,
      promotion_ends_at: promotionEndsAt,
      current_stock: stock,
      status,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Impossible de créer le produit: ${error?.message}`);
  }

  if (input.imageUrl) {
    await appendProductImage(input.organizationId, data.id, input.imageUrl);
  }

  return { productId: data.id, slug };
}

export interface ProductImageItem {
  id: string;
  url: string;
  position: number;
}

/**
 * Galerie complète d'un produit, triée par position — `position: 0` est
 * TOUJOURS la photo principale (utilisée par la vitrine, les fiches
 * produit, WhatsApp/publications). Lot 2 (master prompt §15) : la table
 * le permettait déjà, seule la gestion multi-photos manquait côté
 * dashboard (V1 ne gérait qu'une seule photo, voir historique git).
 */
export async function listProductImages(organizationId: string, productId: string): Promise<ProductImageItem[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("product_images")
    .select("id, url, position")
    .eq("organization_id", organizationId)
    .eq("product_id", productId)
    .order("position", { ascending: true });

  if (error) throw new Error(`Erreur lecture des photos du produit ${productId}: ${error.message}`);
  return data ?? [];
}

/** Ajoute une photo à la FIN de la galerie (jamais en position 0 — n'écrase jamais la photo principale existante). */
export async function appendProductImage(organizationId: string, productId: string, url: string): Promise<void> {
  const existing = await listProductImages(organizationId, productId);
  const nextPosition = existing.length > 0 ? Math.max(...existing.map((i) => i.position)) + 1 : 0;

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("product_images")
    .insert({ organization_id: organizationId, product_id: productId, url, position: nextPosition });

  if (error) throw new Error(`Impossible d'ajouter la photo: ${error.message}`);
}

/**
 * Version plurielle — une seule requête d'insertion pour plusieurs
 * photos, positions contiguës à la suite de la galerie existante.
 * CORRECTIF (retour commerçant, sept. 2026) : la galerie ne pouvait
 * jusqu'ici s'enrichir qu'une photo à la fois (un enregistrement par
 * photo) — voir `resolveImagesFromFormData` (media-service.ts) pour le
 * chemin complet, du formulaire jusqu'ici.
 */
export async function appendProductImages(organizationId: string, productId: string, urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const existing = await listProductImages(organizationId, productId);
  const startPosition = existing.length > 0 ? Math.max(...existing.map((i) => i.position)) + 1 : 0;

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("product_images").insert(
    urls.map((url, index) => ({
      organization_id: organizationId,
      product_id: productId,
      url,
      position: startPosition + index,
    })),
  );

  if (error) throw new Error(`Impossible d'ajouter les photos: ${error.message}`);
}

/** Referme l'écart des positions (toujours 0,1,2... contigu) — nécessaire après une suppression pour que "position 0" reste un repère fiable de photo principale. */
async function renumberProductImages(organizationId: string, productId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const images = await listProductImages(organizationId, productId);
  const updates = images
    .map((img, correctPosition) => ({ img, correctPosition }))
    .filter(({ img, correctPosition }) => img.position !== correctPosition);

  await Promise.all(
    updates.map(({ img, correctPosition }) =>
      supabase.from("product_images").update({ position: correctPosition }).eq("id", img.id),
    ),
  );
}

export async function removeProductImage(organizationId: string, productId: string, imageId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("product_images")
    .delete()
    .eq("id", imageId)
    .eq("organization_id", organizationId)
    .eq("product_id", productId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Impossible de supprimer la photo: ${error.message}`);
  if (!data) throw new NotFoundError("Photo introuvable.");

  await renumberProductImages(organizationId, productId);
}

/**
 * Échange la position de deux photos adjacentes — mécanisme "monter/
 * descendre" par boutons (cohérent avec le réordonnancement des sections
 * de landing, dashboard/site/page.tsx::moveSectionAction), jamais de
 * drag-and-drop (master prompt §11 : éviter la complexité inutile pour le
 * MVP). No-op silencieux si déjà à l'extrémité — pas une erreur.
 */
export async function moveProductImage(
  organizationId: string,
  productId: string,
  imageId: string,
  direction: "up" | "down",
): Promise<void> {
  const images = await listProductImages(organizationId, productId);
  const index = images.findIndex((img) => img.id === imageId);
  if (index === -1) throw new NotFoundError("Photo introuvable.");

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= images.length) return;

  const current = images[index]!;
  const swapWith = images[swapIndex]!;

  const supabase = getSupabaseServiceClient();
  await Promise.all([
    supabase.from("product_images").update({ position: swapWith.position }).eq("id", current.id),
    supabase.from("product_images").update({ position: current.position }).eq("id", swapWith.id),
  ]);
}

/** Bascule une photo en position 0 (principale) en l'échangeant avec l'actuelle principale — jamais un delete+reinsert (perdrait l'id, les futures références). */
export async function setPrimaryProductImage(
  organizationId: string,
  productId: string,
  imageId: string,
): Promise<void> {
  const images = await listProductImages(organizationId, productId);
  const target = images.find((img) => img.id === imageId);
  if (!target) throw new NotFoundError("Photo introuvable.");
  if (target.position === 0) return;

  const currentPrimary = images.find((img) => img.position === 0);
  const supabase = getSupabaseServiceClient();

  await supabase.from("product_images").update({ position: 0 }).eq("id", target.id);
  if (currentPrimary) {
    await supabase.from("product_images").update({ position: target.position }).eq("id", currentPrimary.id);
  }
}

// ---------------------------------------------------------------------------
// Catalogue V2 (0056) — "informations complémentaires" : liste ordonnée de
// paires libellé/valeur (products.specifications, JSONB). Même politique
// que la galerie photo ci-dessus : une action dédiée par opération
// (ajouter/supprimer), jamais mélangée à updateProduct pour ne jamais
// écraser silencieusement la liste par un update partiel du reste du
// formulaire.
// ---------------------------------------------------------------------------

async function readProductSpecifications(organizationId: string, productId: string): Promise<CatalogSpecification[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("specifications")
    .eq("id", productId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture des informations complémentaires du produit ${productId}: ${error.message}`);
  if (!data) throw new NotFoundError("Produit introuvable.");
  return (data as unknown as { specifications?: CatalogSpecification[] | null }).specifications ?? [];
}

export async function listProductSpecifications(organizationId: string, productId: string): Promise<CatalogSpecification[]> {
  return readProductSpecifications(organizationId, productId);
}

/** Ajoute une ligne à la FIN de la liste — jamais de réordonnancement (pas critique comme la photo principale, section 11 : éviter la complexité inutile pour le MVP). */
export async function addProductSpecification(
  organizationId: string,
  productId: string,
  label: string,
  value: string,
): Promise<void> {
  const existing = await readProductSpecifications(organizationId, productId);
  const parsed = CatalogSpecificationsSchema.safeParse([...existing, { label, value }]);
  if (!parsed.success) {
    throw new ValidationError(
      "Informations invalides : libellé et valeur obligatoires (12 lignes maximum au total).",
    );
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("products")
    .update({ specifications: parsed.data })
    .eq("id", productId)
    .eq("organization_id", organizationId);

  if (error) throw new Error(`Impossible d'ajouter l'information: ${error.message}`);
}

export async function removeProductSpecification(
  organizationId: string,
  productId: string,
  index: number,
): Promise<void> {
  const existing = await readProductSpecifications(organizationId, productId);
  const next = existing.filter((_, i) => i !== index);

  const supabase = getSupabaseServiceClient();
  // [] explicite (retrait volontaire de la dernière ligne), jamais null ici
  // — null resterait réservé au produit qui n'a jamais rien configuré (voir
  // commentaire de la colonne, migration 0056). Un affichage public traite
  // les deux de la même façon (bloc masqué), la distinction n'a d'intérêt
  // que pour un futur historique, pas pour ce chemin.
  const { error } = await supabase
    .from("products")
    .update({ specifications: next })
    .eq("id", productId)
    .eq("organization_id", organizationId);

  if (error) throw new Error(`Impossible de supprimer l'information: ${error.message}`);
}

export interface UpdateProductInput {
  name: string;
  description?: string;
  /** Réservé à l'import CSV — voir la note de `CreateProductInput`. */
  categoryName?: string;
  /** Id d'une catégorie existante — prioritaire sur `categoryName`. */
  categoryId?: string;
  unitPrice: number;
  currentStock?: number;
  status?: "draft" | "active" | "out_of_stock" | "inactive";
  /** Lot H, Partie 1 — optionnels comme le reste des champs de cette fonction. */
  seoTitle?: string;
  seoDescription?: string;
  /** Prix barré — voir CreateProductInput. `null` explicite retire la promotion. */
  compareAtPrice?: number | null;
  /**
   * Échéance de la promotion — catalogue V2, itération 2 (0057). N'est
   * pris en compte QUE lorsque `compareAtPrice` fait partie du même
   * appel (voir la normalisation dans `updateProduct` ci-dessous) :
   * l'écran d'édition envoie toujours les deux champs ensemble, jamais
   * l'un sans l'autre.
   */
  promotionEndsAt?: string | null;
}

/**
 * Édition d'un produit existant (Lot E, Partie 2). `organizationId` fait
 * TOUJOURS partie du WHERE (jamais un update par id seul, même avec RLS en
 * filet de sécurité — 00_CONVENTIONS_COMMUNES.md, règle IDOR).
 *
 * Ne gère plus la photo (Lot 2) : la galerie multi-photos
 * (listProductImages/appendProductImage/removeProductImage/
 * moveProductImage/setPrimaryProductImage ci-dessus) est gérée par des
 * actions dédiées sur l'écran d'édition, pas mélangée à la mise à jour
 * des champs texte — deux responsabilités, deux mécanismes, jamais l'un
 * qui écrase l'autre par effet de bord.
 */
export async function updateProduct(
  productId: string,
  organizationId: string,
  input: UpdateProductInput,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const categoryId =
    input.categoryId !== undefined
      ? input.categoryId || null
      : input.categoryName
        ? await findOrCreateCategory(organizationId, input.categoryName)
        : null;

  // `current_stock`/`status` ne sont inclus dans le payload que s'ils sont
  // explicitement fournis — un appelant qui omettrait ces champs ne doit
  // JAMAIS remettre silencieusement le stock à 0 ou le statut à draft
  // (section 10 : les transitions de statut sont significatives, pas un
  // effet de bord d'un update partiel).
  const updatePayload: Record<string, unknown> = {
    name: input.name,
    description: input.description ?? null,
    category_id: categoryId,
    unit_price: input.unitPrice,
  };
  if (input.currentStock !== undefined) updatePayload.current_stock = input.currentStock;
  if (input.status !== undefined) updatePayload.status = input.status;
  // Lot H — mêmes règles qu'ailleurs dans cette fonction : un champ omis ne
  // touche pas la colonne, il ne l'écrase jamais silencieusement à null.
  if (input.seoTitle !== undefined) updatePayload.seo_title = input.seoTitle || null;
  if (input.seoDescription !== undefined) updatePayload.seo_description = input.seoDescription || null;
  // Un prix barré <= au prix courant n'a pas de sens (jamais une "promo"
  // à l'envers affichée à un client) — silencieusement ramené à null
  // plutôt qu'une erreur bloquante pour une simple faute de saisie.
  if (input.compareAtPrice !== undefined) {
    const finalCompareAtPrice =
      input.compareAtPrice !== null && input.compareAtPrice > input.unitPrice ? input.compareAtPrice : null;
    updatePayload.compare_at_price = finalCompareAtPrice;
    // Jamais une échéance orpheline (voir CreateProductInput) : sans
    // promotion réelle après normalisation, aucune échéance n'a de sens.
    updatePayload.promotion_ends_at = finalCompareAtPrice ? (input.promotionEndsAt ?? null) : null;
  }

  const { data, error } = await supabase
    .from("products")
    .update(updatePayload)
    .eq("id", productId)
    .eq("organization_id", organizationId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de mettre à jour le produit ${productId}: ${error.message}`);
  }
  if (!data) {
    throw new NotFoundError("Produit introuvable");
  }
}

export interface ProductForEdit {
  id: string;
  name: string;
  description: string | null;
  categoryName: string | null;
  categoryId: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  /** Catalogue V2, itération 2 (0057) — valeur BRUTE telle qu'enregistrée (contrairement à CatalogProductDetail, jamais masquée si dépassée : le commerçant doit toujours voir ce qu'il a configuré pour pouvoir le relancer). */
  promotionEndsAt: string | null;
  /** Dérivé ici pour que l'écran d'édition n'ait aucune règle de date à recalculer — vrai si une échéance est renseignée et déjà dépassée. */
  isPromotionExpired: boolean;
  currentStock: number;
  status: string;
  imageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  /** Catalogue V2 (0056) — jamais undefined : [] si aucune configurée. */
  specifications: CatalogSpecification[];
}

/** Charge un produit pour pré-remplir le formulaire d'édition (Partie 2). */
export async function getProductForEdit(organizationId: string, productId: string): Promise<ProductForEdit> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, description, category_id, unit_price, compare_at_price, promotion_ends_at, current_stock, status, seo_title, seo_description, specifications, categories(name), product_images(url, position)",
    )
    .eq("id", productId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture produit ${productId}: ${error.message}`);
  if (!data) throw new NotFoundError("Produit introuvable");

  const images = (
    (data as unknown as { product_images?: { url: string; position: number }[] }).product_images ?? []
  ).sort((a, b) => a.position - b.position);

  const promotionEndsAt = (data as unknown as { promotion_ends_at?: string | null }).promotion_ends_at ?? null;

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    categoryName: (data as unknown as { categories?: { name?: string } }).categories?.name ?? null,
    categoryId: (data as unknown as { category_id?: string | null }).category_id ?? null,
    unitPrice: Number(data.unit_price),
    compareAtPrice: data.compare_at_price ? Number(data.compare_at_price) : null,
    promotionEndsAt,
    isPromotionExpired: Boolean(promotionEndsAt) && Date.parse(promotionEndsAt!) <= Date.now(),
    currentStock: Number(data.current_stock),
    status: data.status,
    imageUrl: images[0]?.url ?? null,
    seoTitle: data.seo_title,
    seoDescription: data.seo_description,
    specifications: (data as unknown as { specifications?: CatalogSpecification[] | null }).specifications ?? [],
  };
}

// ============================================================
// Vitrine V2 — lecture catalogue enrichie
// ============================================================
//
// Pourquoi une famille de fonctions distincte de
// `listActiveProductsForStorefront` plutôt qu'une extension en place :
// cette dernière est aussi consommée par `sitemap.ts`, par
// `/dashboard/groups` et par la diffusion WhatsApp, qui n'ont besoin que
// du strict minimum (id/nom/prix/photo). Leur faire payer les requêtes
// supplémentaires de badges/ventes serait une régression de performance
// sur des chemins qui n'affichent aucune vitrine. `StorefrontProduct`
// ÉTEND `CatalogProductSummary` : un `StorefrontProduct` reste utilisable
// partout où un `CatalogProductSummary` est attendu.

/**
 * Badges affichés sur une carte produit. TOUS dérivés de données réelles :
 *  - `promo`       : compare_at_price > unit_price (même définition que la page produit)
 *  - `new`         : created_at dans les 30 derniers jours
 *  - `bestseller`  : figure dans le top des ventes réelles (order_items)
 *  - `featured`    : épinglé manuellement par le commerçant (products.is_featured)
 *  - `out_of_stock`: status = 'out_of_stock'
 * Aucun badge décoratif : rien ne s'affiche qui ne corresponde pas à un
 * fait vérifiable dans la base du tenant.
 */
export type ProductBadge = "promo" | "new" | "bestseller" | "featured" | "out_of_stock";

export interface StorefrontProduct extends CatalogProductSummary {
  compareAtPrice: number | null;
  /** Catalogue V2, itération 2 (0057) — `null` si pas d'échéance ou promotion expirée (voir isPromotionCurrentlyOn, appliqué avant que cet objet soit construit). */
  promotionEndsAt: string | null;
  /** Remise arrondie à l'entier inférieur, `null` hors promotion. Calculée ici pour que l'affichage n'ait aucune règle métier. */
  discountPercent: number | null;
  createdAt: string;
  isFeatured: boolean;
  status: string;
  badges: ProductBadge[];
}

export type StorefrontProductSort = "featured" | "recent" | "price_asc" | "price_desc" | "name";

export interface ListStorefrontProductsOptions {
  limit?: number;
  offset?: number;
  categoryId?: string;
  /** Recherche plein texte simple sur le nom (ILIKE) — voir `searchProductsByName` pour la variante utilisée par l'IA conversationnelle. */
  search?: string;
  sort?: StorefrontProductSort;
  /** Ne retourne que les produits en promotion réelle (compare_at_price > unit_price). */
  promotionsOnly?: boolean;
  /** Ne retourne que les produits épinglés (products.is_featured). */
  featuredOnly?: boolean;
  /**
   * Calcul des badges « best-seller » (une requête supplémentaire sur
   * order_items). Désactivable pour les écrans qui n'affichent pas de
   * badge — par défaut activé, la vitrine étant le seul appelant.
   */
  withBadges?: boolean;
  /** Exclut un produit du résultat — utilisé par « produits similaires » sur la fiche produit. */
  excludeProductId?: string;
}

const NEW_PRODUCT_WINDOW_DAYS = 30;

/** Nombre de produits considérés comme « best-sellers » — un badge sur la moitié du catalogue ne signifierait plus rien. */
const BESTSELLER_POOL_SIZE = 5;

/**
 * Identifiants des produits les plus vendus, par quantité réellement
 * facturée (`order_items.quantity`). PostgREST n'expose pas d'agrégat
 * `group by` via le query builder fluide ; l'agrégation se fait donc en
 * mémoire, sur les lignes de commande les plus récentes uniquement
 * (`ORDER BY created_at DESC LIMIT 500`) — un best-seller est par nature
 * une notion récente, et cette borne garantit un coût constant quelle que
 * soit l'ancienneté du tenant.
 */
export async function getBestSellerProductIds(
  organizationId: string,
  poolSize = BESTSELLER_POOL_SIZE,
): Promise<Set<string>> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("order_items")
    .select("product_id, quantity, created_at")
    .eq("organization_id", organizationId)
    .not("product_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    // Jamais bloquant : un badge manquant ne doit pas empêcher une
    // vitrine de s'afficher (même principe que getLandingConfig sur un
    // jsonb corrompu).
    console.error(`getBestSellerProductIds(${organizationId}) error:`, error.message);
    return new Set();
  }

  const quantityByProduct = new Map<string, number>();
  for (const item of data ?? []) {
    if (!item.product_id) continue;
    quantityByProduct.set(item.product_id, (quantityByProduct.get(item.product_id) ?? 0) + Number(item.quantity ?? 0));
  }

  return new Set(
    [...quantityByProduct.entries()]
      .filter(([, quantity]) => quantity > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, poolSize)
      .map(([productId]) => productId),
  );
}

function computeProductBadges(
  input: { createdAt: string; unitPrice: number; compareAtPrice: number | null; isFeatured: boolean; status: string },
  bestSellerIds: Set<string>,
  productId: string,
): ProductBadge[] {
  const badges: ProductBadge[] = [];

  if (input.status === "out_of_stock") badges.push("out_of_stock");
  if (input.compareAtPrice != null && input.compareAtPrice > input.unitPrice) badges.push("promo");

  const createdAtMs = Date.parse(input.createdAt);
  if (!Number.isNaN(createdAtMs) && Date.now() - createdAtMs < NEW_PRODUCT_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    badges.push("new");
  }

  if (bestSellerIds.has(productId)) badges.push("bestseller");
  // `featured` n'est ajouté que s'il apporte une information que les
  // autres badges ne portent pas déjà : un produit épinglé ET en promo
  // afficherait sinon deux pastilles concurrentes au même endroit.
  if (input.isFeatured && badges.length === 0) badges.push("featured");

  return badges;
}

function discountPercentOf(unitPrice: number, compareAtPrice: number | null): number | null {
  if (compareAtPrice == null || compareAtPrice <= unitPrice || compareAtPrice <= 0) return null;
  return Math.floor(((compareAtPrice - unitPrice) / compareAtPrice) * 100);
}

const STOREFRONT_PRODUCT_COLUMNS =
  "id, name, slug, unit_price, compare_at_price, promotion_ends_at, description, status, is_featured, created_at, categories(name), product_images(url, position)";

/**
 * Lecture catalogue de la vitrine, avec filtres, tri, recherche et
 * badges. Les produits `out_of_stock` sont VOLONTAIREMENT inclus (le
 * projet interdit explicitement de faire disparaître un produit épuisé,
 * voir 0008_catalog_faq_business.sql) : ils sont retournés avec le badge
 * correspondant, à charge de l'affichage de les présenter comme
 * indisponibles plutôt que de les masquer.
 *
 * Le tri « promotion réelle » (compare_at_price > unit_price) ne peut pas
 * s'exprimer côté PostgREST — comparaison de deux colonnes, limitation
 * déjà documentée dans `listPromotedProductsForStorefront`. Il est donc
 * appliqué en mémoire après un sur-échantillonnage, exactement comme là-bas.
 */
export async function listStorefrontProducts(
  organizationId: string,
  options: ListStorefrontProductsOptions = {},
): Promise<StorefrontProduct[]> {
  const supabase = getSupabaseServiceClient();
  const sort = options.sort ?? "featured";
  const needsInMemoryFilter = Boolean(options.promotionsOnly);

  let query = supabase
    .from("products")
    .select(STOREFRONT_PRODUCT_COLUMNS)
    .eq("organization_id", organizationId)
    .in("status", ["active", "out_of_stock"]);

  if (options.categoryId) query = query.eq("category_id", options.categoryId);
  if (options.featuredOnly) query = query.eq("is_featured", true);
  if (options.promotionsOnly) query = query.not("compare_at_price", "is", null);
  if (options.excludeProductId) query = query.neq("id", options.excludeProductId);
  if (options.search?.trim()) {
    // `%` et `_` sont les jokers de LIKE : sans échappement, une
    // recherche « 100% coton » se comporterait comme un joker et
    // remonterait n'importe quoi. `\` doit être échappé en premier.
    const escaped = options.search.trim().replace(/[\\%_]/g, (match) => `\\${match}`);
    query = query.ilike("name", `%${escaped}%`);
  }

  switch (sort) {
    case "recent":
      query = query.order("created_at", { ascending: false });
      break;
    case "price_asc":
      query = query.order("unit_price", { ascending: true });
      break;
    case "price_desc":
      query = query.order("unit_price", { ascending: false });
      break;
    case "name":
      query = query.order("name", { ascending: true });
      break;
    case "featured":
    default:
      // Épinglés d'abord, puis les plus récents — l'ordre de la page
      // d'accueil. `nullsFirst: false` évite qu'un created_at nul (jeu de
      // données importé) ne remonte en tête.
      query = query.order("is_featured", { ascending: false }).order("created_at", { ascending: false, nullsFirst: false });
      break;
  }

  if (options.limit !== undefined && !needsInMemoryFilter) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  } else if (needsInMemoryFilter && options.limit !== undefined) {
    query = query.limit(options.limit * 4);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture vitrine catalogue : ${error.message}`);

  const bestSellerIds =
    options.withBadges === false ? new Set<string>() : await getBestSellerProductIds(organizationId);

  let products: StorefrontProduct[] = (data ?? []).map((p) => {
    const raw = p as unknown as {
      categories?: { name?: string };
      product_images?: { url: string; position: number }[];
      promotion_ends_at?: string | null;
    };
    const unitPrice = Number(p.unit_price);
    const rawCompareAtPrice = p.compare_at_price == null ? null : Number(p.compare_at_price);
    const rawPromotionEndsAt = raw.promotion_ends_at ?? null;
    // Effectif partout ici : une promotion expirée ne doit alimenter ni
    // le prix barré, ni le badge `promo`, ni le filtre `promotionsOnly`
    // ci-dessous — voir isPromotionCurrentlyOn et le commentaire de la
    // migration 0057.
    const promotionOn = isPromotionCurrentlyOn(rawCompareAtPrice, unitPrice, rawPromotionEndsAt);
    const compareAtPrice = promotionOn ? rawCompareAtPrice : null;
    const promotionEndsAt = promotionOn ? rawPromotionEndsAt : null;
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      unitPrice,
      compareAtPrice,
      promotionEndsAt,
      discountPercent: discountPercentOf(unitPrice, compareAtPrice),
      description: p.description,
      categoryName: raw.categories?.name ?? null,
      imageUrl: resolvePrimaryImageUrl(raw.product_images),
      createdAt: p.created_at,
      isFeatured: Boolean(p.is_featured),
      status: p.status,
      badges: computeProductBadges(
        {
          createdAt: p.created_at,
          unitPrice,
          compareAtPrice,
          isFeatured: Boolean(p.is_featured),
          status: p.status,
        },
        bestSellerIds,
        p.id,
      ),
    };
  });

  if (options.promotionsOnly) {
    products = products.filter((product) => product.compareAtPrice != null && product.compareAtPrice > product.unitPrice);
    if (options.limit !== undefined) {
      const from = options.offset ?? 0;
      products = products.slice(from, from + options.limit);
    }
  }

  return products;
}

/** Total correspondant aux mêmes filtres que `listStorefrontProducts`, pour la pagination du catalogue public. */
export async function countStorefrontProducts(
  organizationId: string,
  options: Pick<ListStorefrontProductsOptions, "categoryId" | "search" | "promotionsOnly" | "featuredOnly"> = {},
): Promise<number> {
  const supabase = getSupabaseServiceClient();

  // Cas « promotions » : le filtre réel (deux colonnes comparées) n'étant
  // pas exprimable côté serveur, le comptage exact passe par la lecture
  // des seules colonnes de prix, pas par un `count` PostgREST qui
  // compterait aussi les compare_at_price ≤ unit_price (saisie erronée
  // fréquente) et afficherait une pagination fantôme.
  if (options.promotionsOnly) {
    const { data, error } = await supabase
      .from("products")
      .select("unit_price, compare_at_price, promotion_ends_at")
      .eq("organization_id", organizationId)
      .in("status", ["active", "out_of_stock"])
      .not("compare_at_price", "is", null);
    if (error) throw new Error(`Erreur comptage promotions : ${error.message}`);
    // Catalogue V2, itération 2 (0057) : une promotion dont l'échéance est
    // dépassée ne doit plus compter — même filtre que listStorefrontProducts,
    // sinon la pagination promettrait une page que le contenu ne tient plus.
    return (data ?? []).filter((p) =>
      isPromotionCurrentlyOn(Number(p.compare_at_price), Number(p.unit_price), p.promotion_ends_at),
    ).length;
  }

  let query = supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["active", "out_of_stock"]);

  if (options.categoryId) query = query.eq("category_id", options.categoryId);
  if (options.featuredOnly) query = query.eq("is_featured", true);
  if (options.search?.trim()) {
    const escaped = options.search.trim().replace(/[\\%_]/g, (match) => `\\${match}`);
    query = query.ilike("name", `%${escaped}%`);
  }

  const { count, error } = await query;
  if (error) throw new Error(`Erreur comptage vitrine catalogue : ${error.message}`);
  return count ?? 0;
}

export interface StorefrontCategory {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  /**
   * Vignette. `categories.image_url` si le commerçant en a défini une,
   * sinon la photo principale d'un produit RÉEL de la catégorie. Jamais
   * d'illustration générique : une vignette qui ne montre pas ce que le
   * client va trouver derrière est un mensonge visuel.
   */
  imageUrl: string | null;
  position: number;
}

/**
 * Catégories ayant au moins un produit visible (actif ou en rupture),
 * triées par `position` puis par nom. Remplace
 * `listCategoriesWithProductCounts` (landing-config-service.ts) pour
 * toute la vitrine : même contrat, plus la vignette et l'ordre choisi par
 * le commerçant.
 *
 * Trois requêtes plutôt qu'un agrégat embarqué PostgREST, cohérent avec
 * le reste du projet : catégories, produits (pour le comptage), photos
 * (pour le repli de vignette). Les deux dernières sont parallélisées.
 */
export async function listStorefrontCategories(organizationId: string): Promise<StorefrontCategory[]> {
  const supabase = getSupabaseServiceClient();

  const [{ data: categories, error: categoriesError }, { data: products, error: productsError }] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, slug, image_url, position")
      .eq("organization_id", organizationId)
      .order("position")
      .order("name"),
    supabase
      .from("products")
      .select("id, category_id")
      .eq("organization_id", organizationId)
      .in("status", ["active", "out_of_stock"]),
  ]);

  if (categoriesError) throw new Error(`Erreur lecture catégories : ${categoriesError.message}`);
  if (productsError) throw new Error(`Erreur comptage produits par catégorie : ${productsError.message}`);

  const counts = new Map<string, number>();
  const productIdsByCategory = new Map<string, string[]>();
  for (const product of products ?? []) {
    if (!product.category_id) continue;
    counts.set(product.category_id, (counts.get(product.category_id) ?? 0) + 1);
    const bucket = productIdsByCategory.get(product.category_id);
    if (bucket) bucket.push(product.id);
    else productIdsByCategory.set(product.category_id, [product.id]);
  }

  // Repli de vignette : une seule requête pour toutes les catégories qui
  // n'ont pas d'image propre, plutôt qu'une requête par catégorie.
  const categoriesNeedingFallback = (categories ?? []).filter(
    (category) => !category.image_url && (counts.get(category.id) ?? 0) > 0,
  );
  const candidateProductIds = categoriesNeedingFallback.flatMap(
    (category) => productIdsByCategory.get(category.id)?.slice(0, 4) ?? [],
  );

  const imageByProductId = new Map<string, string>();
  if (candidateProductIds.length > 0) {
    const { data: images, error: imagesError } = await supabase
      .from("product_images")
      .select("product_id, url, position")
      .eq("organization_id", organizationId)
      .in("product_id", candidateProductIds)
      .order("position");
    if (imagesError) throw new Error(`Erreur lecture vignettes de catégorie : ${imagesError.message}`);
    for (const image of images ?? []) {
      if (!imageByProductId.has(image.product_id)) imageByProductId.set(image.product_id, image.url);
    }
  }

  return (categories ?? [])
    .map((category) => {
      const productCount = counts.get(category.id) ?? 0;
      const fallbackImage =
        category.image_url ??
        (productIdsByCategory.get(category.id) ?? [])
          .map((productId) => imageByProductId.get(productId))
          .find((url): url is string => Boolean(url)) ??
        null;

      return {
        id: category.id,
        name: category.name,
        slug: category.slug,
        productCount,
        imageUrl: fallbackImage,
        position: category.position ?? 0,
      };
    })
    .filter((category) => category.productCount > 0);
}

/** Variante mono-catégorie de `listStorefrontCategories`, pour la page /categories/[slug]. */
export async function getStorefrontCategoryBySlug(
  organizationId: string,
  slug: string,
): Promise<StorefrontCategory | null> {
  const categories = await listStorefrontCategories(organizationId);
  return categories.find((category) => category.slug === slug) ?? null;
}

/** Bornes de prix du catalogue visible — alimente le filtre de prix du catalogue public sans valeurs codées en dur. */
export async function getStorefrontPriceRange(
  organizationId: string,
): Promise<{ min: number; max: number } | null> {
  const supabase = getSupabaseServiceClient();
  const [{ data: cheapest }, { data: priciest }] = await Promise.all([
    supabase
      .from("products")
      .select("unit_price")
      .eq("organization_id", organizationId)
      .in("status", ["active", "out_of_stock"])
      .order("unit_price", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("products")
      .select("unit_price")
      .eq("organization_id", organizationId)
      .in("status", ["active", "out_of_stock"])
      .order("unit_price", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!cheapest || !priciest) return null;
  const min = Number(cheapest.unit_price);
  const max = Number(priciest.unit_price);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return null;
  return { min, max };
}
