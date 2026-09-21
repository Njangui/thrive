import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Lectures LÉGÈRES réservées au sitemap : slug + date de dernière
 * modification, rien d'autre.
 *
 * Avant, `sitemap.ts` chargeait le catalogue complet via
 * `listActiveProductsForStorefront` (descriptions, prix, jointure sur les
 * images…) pour n'en garder que le slug, et sans pagination : au-delà de
 * 1000 lignes (plafond PostgREST par défaut) les produits suivants
 * disparaissaient du sitemap sans erreur.
 */
export interface SitemapSource {
  slug: string;
  /** `updated_at` de la ligne (date ISO) — alimente `<lastmod>`. */
  updatedAt: string | null;
}

/** Plafond de lignes renvoyées par requête par PostgREST (config Supabase par défaut). */
const PAGE_SIZE = 1000;
/** Garde-fou : un sitemap est limité à 50 000 URL, et un tenant n'en approche pas. */
const MAX_ENTRIES = 10_000;

async function listSlugs(
  table: "products" | "services",
  organizationId: string,
  statuses: string[],
): Promise<SitemapSource[]> {
  const supabase = getSupabaseServiceClient();
  const entries: SitemapSource[] = [];

  for (let from = 0; from < MAX_ENTRIES; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("slug, updated_at")
      .eq("organization_id", organizationId)
      .in("status", statuses)
      .not("slug", "is", null)
      // Ordre stable, sinon la pagination `range` peut sauter ou répéter des lignes.
      .order("slug", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Erreur lecture sitemap (${table}) : ${error.message}`);

    const rows = data ?? [];
    for (const row of rows) {
      if (row.slug) entries.push({ slug: row.slug as string, updatedAt: (row.updated_at as string | null) ?? null });
    }
    if (rows.length < PAGE_SIZE) break;
  }

  return entries;
}

/**
 * Produits dont la fiche est indexable : `active` ET `out_of_stock` (une
 * rupture est temporaire — la fiche reste publique, indexable, avec
 * `availability: OutOfStock`). `draft` et `inactive` en sont exclus : même
 * règle que le `noindex` de la fiche.
 */
export function listSitemapProducts(organizationId: string): Promise<SitemapSource[]> {
  return listSlugs("products", organizationId, ["active", "out_of_stock"]);
}

/** Prestations publiées (`active` uniquement). */
export function listSitemapServices(organizationId: string): Promise<SitemapSource[]> {
  return listSlugs("services", organizationId, ["active"]);
}
