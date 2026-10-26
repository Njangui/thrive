import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { CatalogProductSummary } from "./catalog-service";
import type { ParsedProductQuery } from "./product-query-parser";

/**
 * C3 — recherche produit de l'assistant client (étape 1 : texte français +
 * fautes + filtres + règles métier, voir 0140_c3_product_search.sql).
 *
 * Isolation (principe 5) : le client est service-role, donc CHAQUE appel
 * passe `p_organization_id` et la fonction SQL filtre dessus ; aucune requête
 * de ce module n'est exécutée sans organisation.
 *
 * Prix et stock affichés viennent UNIQUEMENT de la base (aucune valeur n'est
 * produite par un modèle). Voir docs/agents/c3-recherche-produits.md.
 */

export interface AssistantProductHit extends CatalogProductSummary {
  compareAtPrice: number | null;
  /** Promotion réellement en cours (prix barré > prix, échéance non dépassée). */
  isPromo: boolean;
  score: number;
}

export interface ProductSearchOutcome {
  products: AssistantProductHit[];
  /** `true` = rien dans la fourchette de prix demandée ; ce sont les articles les plus proches du budget. */
  relaxed: boolean;
}

export interface ProductSearchOptions {
  limit?: number;
  categorySlug?: string | null;
}

type SearchRow = {
  id: string;
  name: string;
  slug: string | null;
  unit_price: number | string;
  compare_at_price: number | string | null;
  description: string | null;
  category_name: string | null;
  is_promo: boolean;
  image_url: string | null;
  score: number | string;
};

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;
/** Marge de candidats pour pouvoir re-trier par proximité du budget quand on relâche le prix. */
const RELAX_FETCH_FACTOR = 4;

function toHit(row: SearchRow): AssistantProductHit {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    unitPrice: Number(row.unit_price),
    description: row.description,
    categoryName: row.category_name,
    imageUrl: row.image_url,
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    isPromo: Boolean(row.is_promo),
    score: Number(row.score),
  };
}

async function callSearch(
  organizationId: string,
  args: { terms: string[]; minPrice: number | null; maxPrice: number | null; categorySlug: string | null; limit: number },
): Promise<AssistantProductHit[]> {
  const { data, error } = await getSupabaseServiceClient().rpc("search_products_for_assistant", {
    p_organization_id: organizationId,
    p_terms: args.terms,
    p_min_price: args.minPrice,
    p_max_price: args.maxPrice,
    p_category_slug: args.categorySlug,
    p_limit: args.limit,
  });
  if (error) throw new Error(`Erreur recherche produit: ${error.message}`);
  return ((data ?? []) as SearchRow[]).map(toHit);
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
}

/** Tri stable par écart au budget (utilisé seulement quand on relâche le prix). */
function sortByBudgetProximity(hits: AssistantProductHit[], budget: number | null): AssistantProductHit[] {
  if (budget === null) return hits;
  return hits
    .map((hit, index) => ({ hit, index }))
    .sort((a, b) => Math.abs(a.hit.unitPrice - budget) - Math.abs(b.hit.unitPrice - budget) || a.index - b.index)
    .map((entry) => entry.hit);
}

async function runSearch(organizationId: string, query: ParsedProductQuery, terms: string[], options: ProductSearchOptions): Promise<ProductSearchOutcome> {
  const limit = clampLimit(options.limit);
  const categorySlug = options.categorySlug ?? null;
  const exact = await callSearch(organizationId, { terms, minPrice: query.minPrice, maxPrice: query.maxPrice, categorySlug, limit });
  if (exact.length > 0) return { products: exact, relaxed: false };

  // Rien dans le budget : on le dit au client (relaxed) plutôt que de ne rien répondre
  // ou de présenter un article hors budget comme s'il correspondait.
  if (query.minPrice === null && query.maxPrice === null) return { products: [], relaxed: false };
  const wider = await callSearch(organizationId, {
    terms,
    minPrice: null,
    maxPrice: null,
    categorySlug,
    limit: Math.min(limit * RELAX_FETCH_FACTOR, 20),
  });
  if (wider.length === 0) return { products: [], relaxed: false };
  return { products: sortByBudgetProximity(wider, query.budget).slice(0, limit), relaxed: true };
}

/** Recherche par mots + filtres de prix (la requête vient de `parseProductQuery`). */
export async function searchProducts(organizationId: string, query: ParsedProductQuery, options: ProductSearchOptions = {}): Promise<ProductSearchOutcome> {
  if (query.terms.length === 0) return { products: [], relaxed: false };
  return runSearch(organizationId, query, query.terms, options);
}

/** « Présentez-moi vos produits » : classement par règles métier (mises en avant, promos, marge), plus par date de création. */
export async function browseProducts(organizationId: string, query: Pick<ParsedProductQuery, "minPrice" | "maxPrice" | "budget" | "priceIntent">, options: ProductSearchOptions = {}): Promise<ProductSearchOutcome> {
  return runSearch(organizationId, { terms: [], ...query }, [], options);
}

export interface ProductCategoryEntry {
  name: string;
  slug: string;
  productCount: number;
}

/** Catégories qui ont au moins un produit actif, les plus fournies d'abord. */
export async function listProductCategories(organizationId: string, limit = 10): Promise<ProductCategoryEntry[]> {
  const supabase = getSupabaseServiceClient();
  const [categories, products] = await Promise.all([
    supabase.from("categories").select("id, name, slug").eq("organization_id", organizationId),
    supabase.from("products").select("category_id").eq("organization_id", organizationId).eq("status", "active").not("category_id", "is", null).limit(5000),
  ]);
  if (categories.error) throw new Error(`Erreur lecture catégories: ${categories.error.message}`);
  if (products.error) throw new Error(`Erreur lecture catégories: ${products.error.message}`);

  const counts = new Map<string, number>();
  for (const row of products.data ?? []) {
    const id = (row as { category_id: string }).category_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return (categories.data ?? [])
    .map((c) => ({ name: c.name as string, slug: c.slug as string, productCount: counts.get(c.id as string) ?? 0 }))
    .filter((c) => c.productCount > 0)
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name, "fr"))
    .slice(0, Math.max(1, limit));
}

// Formatage : module pur séparé (voix de marque, bibliothèque de messages) ; ré-exporté ici pour les appelants existants.
export { describePriceRequest, formatProductSearchReply, formatCategoryListReply, formatProductListReply, type ProductSearchReplyContext } from "./product-reply-format";
