import Papa from "papaparse";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { slugify } from "@/domain/entities/catalog";
import { ValidationError, QuotaExceededError } from "@/lib/errors";
import { findOrCreateCategory } from "./catalog-service";
import { canUseFeature } from "./entitlements-service";
import {
  analyzeCatalogRows,
  normalizeKey,
  type CatalogAnalysis,
  type ClarificationItem,
  type DuplicateItem,
  type ColumnMapping,
} from "./catalog-import-analysis";

/**
 * Import « intelligent » du catalogue (C4, livrable A) : colonnes devinées,
 * doublons détectés, TOUT créé en brouillon, rien d'inventé (prix/stock).
 * Complète `importProductsFromCsv` (inchangé) ; l'isolation tenant repose
 * sur l'`organizationId` validé en amont par `requireMembership` (route).
 *
 * Quotas : `canUseFeature("catalog_products")` est appliqué comme dans
 * l'import existant — aucune règle nouvelle ; la politique de quotas
 * est renvoyée au modèle de prix v2 (décision Marc-well).
 */

export interface SmartImportRowFailure { row: number; name: string; error: string }

export interface SmartImportReport {
  dryRun: boolean;
  /** « 87 produits détectés, 82 ajoutés … » — texte prêt à afficher. */
  summary: string;
  totalRows: number;
  created: number;
  createdProductIds: string[];
  stockUnknown: number;
  needsClarification: ClarificationItem[];
  duplicates: DuplicateItem[];
  failed: SmartImportRowFailure[];
  mapping: ColumnMapping;
  warnings: string[];
}

const PAGE = 1000;
const MAX_EXISTING = 20000; // garde-fou : au-delà, la détection de doublons serait partielle -> erreur explicite

async function loadExistingKeys(organizationId: string) {
  const supabase = getSupabaseServiceClient();
  const names = new Set<string>();
  const skus = new Set<string>();
  for (let from = 0; from < MAX_EXISTING; from += PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select("name, sku")
      .eq("organization_id", organizationId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Lecture du catalogue impossible: ${error.message}`);
    for (const p of data ?? []) {
      names.add(normalizeKey(p.name as string));
      if (p.sku) skus.add((p.sku as string).toLowerCase());
    }
    if (!data || data.length < PAGE) return { names, skus };
  }
  throw new ValidationError("Catalogue trop volumineux pour la détection de doublons automatique");
}

function buildSummary(totalRows: number, created: number, needs: number, dups: number, dryRun: boolean): string {
  const added = dryRun ? `${created} prêts à être ajoutés en brouillon` : `${created} ajoutés automatiquement (en brouillon)`;
  const parts = [`${totalRows} produits détectés`, added];
  if (needs > 0) parts.push(`${needs} demandent une précision`);
  if (dups > 0) parts.push(`${dups} doublons ignorés`);
  return parts.join(", ") + ".";
}

export async function importCatalogSmart(
  organizationId: string,
  csvText: string,
  actorUserId: string,
  options: { dryRun?: boolean } = {},
): Promise<SmartImportReport> {
  const dryRun = options.dryRun ?? false;
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const headers = (parsed.meta.fields ?? []).map((h) => h.trim());
  if (headers.length === 0 || (parsed.errors.length > 0 && parsed.data.length === 0)) {
    throw new ValidationError(`Fichier illisible: ${parsed.errors[0]?.message ?? "aucune colonne détectée"}`);
  }

  const existing = await loadExistingKeys(organizationId);
  const analysis: CatalogAnalysis = analyzeCatalogRows(
    parsed.data.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim(), v]))),
    headers,
    existing,
  );

  const failed: SmartImportRowFailure[] = [];
  const createdProductIds: string[] = [];
  let stockUnknown = 0;

  if (!dryRun) {
    const supabase = getSupabaseServiceClient();
    const categoryCache = new Map<string, string>();
    const resolveCategoryId = async (name: string) => {
      const key = normalizeKey(name);
      const cached = categoryCache.get(key);
      if (cached) return cached;
      const id = await findOrCreateCategory(organizationId, name);
      categoryCache.set(key, id);
      return id;
    };

    for (const item of analysis.ready) {
      try {
        const entitlement = await canUseFeature(organizationId, "catalog_products", 1);
        if (!entitlement.allowed) {
          throw new QuotaExceededError(`La limite de ${entitlement.limit.toLocaleString("fr-FR")} produits de votre offre est atteinte.`);
        }
        const categoryId = item.category ? await resolveCategoryId(item.category) : null;

        const { data: product, error } = await supabase
          .from("products")
          .insert({
            organization_id: organizationId,
            name: item.name,
            slug: `${slugify(item.name)}-${Math.random().toString(36).slice(2, 7)}`,
            sku: item.sku ?? null,
            description: item.description ?? null,
            category_id: categoryId,
            unit_price: item.price,
            cost_price: item.costPrice ?? null,
            current_stock: item.stock,
            status: "draft", // toujours brouillon : validation en bloc ensuite
            specifications: item.specifications.length > 0 ? item.specifications : null,
          })
          .select("id")
          .single();
        if (error || !product) throw new Error(error?.message ?? "insert failed");

        if (item.imageUrls.length > 0) {
          await supabase.from("product_images").insert(
            item.imageUrls.map((url, position) => ({ organization_id: organizationId, product_id: product.id, url, position })),
          );
        }
        await supabase.from("audit_logs").insert({
          organization_id: organizationId,
          actor_user_id: actorUserId,
          action: "PRODUCT_IMPORTED_SMART",
          entity_type: "product",
          entity_id: product.id,
          after_state: { name: item.name, price: item.price, status: "draft" },
        });
        createdProductIds.push(product.id as string);
        if (!item.stockKnown) stockUnknown++;
      } catch (rowError) {
        failed.push({ row: item.row, name: item.name, error: rowError instanceof Error ? rowError.message : String(rowError) });
      }
    }
  } else {
    stockUnknown = analysis.ready.filter((p) => !p.stockKnown).length;
  }

  const created = dryRun ? analysis.ready.length : createdProductIds.length;
  const totalRows = parsed.data.length;
  return {
    dryRun,
    summary: buildSummary(totalRows, created, analysis.needsClarification.length, analysis.duplicates.length, dryRun),
    totalRows,
    created,
    createdProductIds,
    stockUnknown,
    needsClarification: analysis.needsClarification,
    duplicates: analysis.duplicates,
    failed,
    mapping: analysis.mapping,
    warnings: analysis.warnings,
  };
}

/**
 * Validation en bloc « en un geste » : passe des brouillons en `active`.
 * Ne touche QUE les produits du tenant, encore en brouillon, au prix > 0.
 * Un produit à stock 0 reste visible mais le statut `out_of_stock` est
 * conservé pour l'affichage (cohérent avec le reste du catalogue).
 */
export async function validateDraftProducts(
  organizationId: string,
  productIds: string[],
  actorUserId: string,
): Promise<{ activated: number; skipped: number }> {
  const ids = [...new Set(productIds)].slice(0, 1000);
  if (ids.length === 0) throw new ValidationError("Aucun produit à valider");
  const supabase = getSupabaseServiceClient();

  const { data: drafts, error } = await supabase
    .from("products")
    .select("id, current_stock, unit_price")
    .eq("organization_id", organizationId)
    .eq("status", "draft")
    .in("id", ids);
  if (error) throw new Error(`Lecture des brouillons impossible: ${error.message}`);

  const eligible = (drafts ?? []).filter((p) => Number(p.unit_price) > 0);
  const inStock = eligible.filter((p) => Number(p.current_stock) > 0).map((p) => p.id as string);
  const outOfStock = eligible.filter((p) => Number(p.current_stock) <= 0).map((p) => p.id as string);

  for (const [status, group] of [["active", inStock], ["out_of_stock", outOfStock]] as const) {
    if (group.length === 0) continue;
    const { error: updateError } = await supabase
      .from("products")
      .update({ status })
      .eq("organization_id", organizationId)
      .eq("status", "draft")
      .in("id", group);
    if (updateError) throw new Error(`Validation impossible: ${updateError.message}`);
  }

  if (eligible.length > 0) {
    await supabase.from("audit_logs").insert({
      organization_id: organizationId,
      actor_user_id: actorUserId,
      action: "PRODUCTS_BULK_VALIDATED",
      entity_type: "product",
      entity_id: null,
      after_state: { count: eligible.length },
    });
  }
  return { activated: eligible.length, skipped: ids.length - eligible.length };
}
