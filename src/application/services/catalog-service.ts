import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { pauseScheduledPostsForProduct } from "./marketing-service";
import { notifyOrgAdmins } from "./notification-service";
import { slugify } from "@/domain/entities/catalog";
import { NotFoundError } from "@/lib/errors";

export interface CatalogProductSummary {
  id: string;
  name: string;
  slug: string | null;
  unitPrice: number;
  description: string | null;
  categoryName: string | null;
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
    .select("id, name, slug, unit_price, description, categories(name)")
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
  }));
}

export interface CatalogProductDetail extends CatalogProductSummary {
  compareAtPrice: number | null;
  currentStock: number;
  status: string;
  images: string[];
  /** Lot H, Partie 1 — repli géré par src/lib/seo.ts::resolveProductSeo, pas ici. */
  seoTitle: string | null;
  seoDescription: string | null;
}

/** Total de produits actifs pour la pagination de la vitrine publique (voir listActiveProductsForStorefront). */
export async function countActiveProducts(organizationId: string): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { count, error } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "active");

  if (error) throw new Error(`Erreur comptage vitrine catalogue: ${error.message}`);
  return count ?? 0;
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
export async function listActiveProductsForStorefront(
  organizationId: string,
  options?: { limit?: number; offset?: number },
): Promise<CatalogProductSummary[]> {
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("products")
    .select("id, name, slug, unit_price, description, categories(name)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("name");

  if (options?.limit !== undefined) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Erreur lecture vitrine catalogue: ${error.message}`);

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    unitPrice: Number(p.unit_price),
    description: p.description,
    categoryName: (p as unknown as { categories?: { name?: string } }).categories?.name ?? null,
  }));
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
      "id, name, slug, unit_price, compare_at_price, current_stock, status, description, seo_title, seo_description, categories(name), product_images(url, position)",
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

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    unitPrice: Number(data.unit_price),
    compareAtPrice: data.compare_at_price ? Number(data.compare_at_price) : null,
    currentStock: Number(data.current_stock),
    status: data.status,
    description: data.description,
    seoTitle: data.seo_title,
    seoDescription: data.seo_description,
    categoryName: (data as unknown as { categories?: { name?: string } }).categories?.name ?? null,
    images,
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
    .select("id, name, slug, unit_price, description, categories(name)")
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
    .select("id, name, slug, unit_price, description, categories(name)")
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
 */
export async function decrementStock(
  organizationId: string,
  productId: string,
  quantity: number,
  reason: string,
  actorUserId?: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("name, current_stock, status")
    .eq("id", productId)
    .eq("organization_id", organizationId)
    .single();

  if (productError || !product) {
    throw new Error(`Produit introuvable pour décrément de stock: ${productId}`);
  }

  const newStock = Math.max(0, Number(product.current_stock) - quantity);
  const newStatus = newStock === 0 && product.status === "active" ? "out_of_stock" : product.status;

  const { error: updateError } = await supabase
    .from("products")
    .update({ current_stock: newStock, status: newStatus })
    .eq("id", productId);

  if (updateError) {
    throw new Error(`Impossible de mettre à jour le stock du produit ${productId}: ${updateError.message}`);
  }

  // Section 52 doc 2 : le flip vers OUT_OF_STOCK doit mettre en pause les
  // publications sociales déjà programmées pour ce produit.
  if (newStatus === "out_of_stock" && product.status !== "out_of_stock") {
    await pauseScheduledPostsForProduct(organizationId, productId);
    await notifyOrgAdmins({
      organizationId,
      title: "Produit en rupture de stock.",
      body: `Le produit "${product.name}" est en rupture de stock.`,
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
 */
export async function restockProduct(
  organizationId: string,
  productId: string,
  quantity: number,
  actorUserId?: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("current_stock, status")
    .eq("id", productId)
    .eq("organization_id", organizationId)
    .single();

  if (productError || !product) {
    throw new Error(`Produit introuvable pour réapprovisionnement: ${productId}`);
  }

  const newStock = Number(product.current_stock) + quantity;
  const newStatus = product.status === "out_of_stock" && newStock > 0 ? "active" : product.status;

  await supabase.from("products").update({ current_stock: newStock, status: newStatus }).eq("id", productId);

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
  categoryName?: string;
  unitPrice: number;
  currentStock?: number;
  status?: "draft" | "active" | "out_of_stock" | "inactive";
  /** URL finale de l'image (déjà résolue — upload ou lien direct, voir media-service.ts). */
  imageUrl?: string;
}

/** Création manuelle depuis le dashboard (section 50) — même chemin de données que l'import CSV. */
export async function createProduct(input: CreateProductInput): Promise<{ productId: string; slug: string }> {
  const supabase = getSupabaseServiceClient();

  const categoryId = input.categoryName ? await findOrCreateCategory(input.organizationId, input.categoryName) : null;
  const slug = `${slugify(input.name)}-${Math.random().toString(36).slice(2, 7)}`;
  const stock = input.currentStock ?? 0;
  const status = input.status ?? (stock > 0 ? "active" : "draft");

  const { data, error } = await supabase
    .from("products")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      slug,
      description: input.description ?? null,
      category_id: categoryId,
      unit_price: input.unitPrice,
      current_stock: stock,
      status,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Impossible de créer le produit: ${error?.message}`);
  }

  if (input.imageUrl) {
    await addProductImage(input.organizationId, data.id, input.imageUrl);
  }

  return { productId: data.id, slug };
}

/**
 * Ajoute une photo produit (Lot E, Partie 1). V1 : une seule photo gérée
 * depuis les écrans création/édition (position 0) — la table
 * `product_images` supporte déjà plusieurs photos/positions pour une
 * évolution future (galerie), pas de sur-ingénierie prématurée tant que ce
 * besoin n'est pas exprimé.
 */
export async function addProductImage(organizationId: string, productId: string, url: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("product_images")
    .insert({ organization_id: organizationId, product_id: productId, url, position: 0 });

  if (error) {
    throw new Error(`Impossible d'enregistrer la photo du produit ${productId}: ${error.message}`);
  }
}

/**
 * Remplace la photo principale (position 0) d'un produit — utilisé par
 * l'édition (Partie 2) : une nouvelle image envoyée remplace l'ancienne
 * plutôt que de s'accumuler tant que la galerie multi-photos n'est pas un
 * besoin réel.
 */
async function replacePrimaryProductImage(organizationId: string, productId: string, url: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { error: deleteError } = await supabase
    .from("product_images")
    .delete()
    .eq("organization_id", organizationId)
    .eq("product_id", productId)
    .eq("position", 0);

  if (deleteError) {
    throw new Error(`Impossible de remplacer la photo du produit ${productId}: ${deleteError.message}`);
  }

  await addProductImage(organizationId, productId, url);
}

export interface UpdateProductInput {
  name: string;
  description?: string;
  categoryName?: string;
  unitPrice: number;
  currentStock?: number;
  status?: "draft" | "active" | "out_of_stock" | "inactive";
  /** URL finale de l'image si elle a changé — omis = photo inchangée. */
  imageUrl?: string;
  /** Lot H, Partie 1 — optionnels comme le reste des champs de cette fonction. */
  seoTitle?: string;
  seoDescription?: string;
}

/**
 * Édition d'un produit existant (Lot E, Partie 2). `organizationId` fait
 * TOUJOURS partie du WHERE (jamais un update par id seul, même avec RLS en
 * filet de sécurité — 00_CONVENTIONS_COMMUNES.md, règle IDOR).
 */
export async function updateProduct(
  productId: string,
  organizationId: string,
  input: UpdateProductInput,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const categoryId = input.categoryName ? await findOrCreateCategory(organizationId, input.categoryName) : null;

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

  if (input.imageUrl) {
    await replacePrimaryProductImage(organizationId, productId, input.imageUrl);
  }
}

export interface ProductForEdit {
  id: string;
  name: string;
  description: string | null;
  categoryName: string | null;
  unitPrice: number;
  currentStock: number;
  status: string;
  imageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

/** Charge un produit pour pré-remplir le formulaire d'édition (Partie 2). */
export async function getProductForEdit(organizationId: string, productId: string): Promise<ProductForEdit> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, description, unit_price, current_stock, status, seo_title, seo_description, categories(name), product_images(url, position)",
    )
    .eq("id", productId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture produit ${productId}: ${error.message}`);
  if (!data) throw new NotFoundError("Produit introuvable");

  const images = (
    (data as unknown as { product_images?: { url: string; position: number }[] }).product_images ?? []
  ).sort((a, b) => a.position - b.position);

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    categoryName: (data as unknown as { categories?: { name?: string } }).categories?.name ?? null,
    unitPrice: Number(data.unit_price),
    currentStock: Number(data.current_stock),
    status: data.status,
    imageUrl: images[0]?.url ?? null,
    seoTitle: data.seo_title,
    seoDescription: data.seo_description,
  };
}
