import Papa from "papaparse";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { slugify, ProductStatusSchema, CatalogSpecificationSchema, type CatalogSpecification } from "@/domain/entities/catalog";
import { findOrCreateCategory } from "./catalog-service";
import { ValidationError, QuotaExceededError } from "@/lib/errors";
import { canUseFeature } from "./entitlements-service";

/**
 * Colonnes CSV attendues (section 11) : name, price, category, description,
 * stock, status.
 *
 * CORRECTIF (retour commerçant, sept. 2026) : ajouter des photos une par
 * une depuis le dashboard demande un enregistrement à chaque photo — geste
 * répété et lent pour un catalogue de plusieurs dizaines de produits. En
 * plus d'assouplir le dashboard lui-même (voir la galerie multi-fichiers
 * de `/dashboard/products/[id]/edit`), l'import CSV — déjà la voie de
 * masse pour tout le reste du catalogue — gagne deux colonnes :
 *
 * - `image_urls` : plusieurs photos pour un même produit, séparées par
 *   `|` (ex: "https://.../1.jpg|https://.../2.jpg"). `image_url` (une
 *   seule, historique) reste accepté pour ne rien casser chez qui l'utilise
 *   déjà ; ignoré si `image_urls` est renseignée sur la même ligne.
 * - `specifications` : informations complémentaires (catalogue V2, 0056),
 *   au format `Libellé:Valeur|Libellé2:Valeur2` (ex:
 *   "Matière:Coton|Garantie:6 mois").
 *
 * Une URL d'image ou une paire libellé/valeur mal formée sur une ligne
 * autrement valide est silencieusement ignorée plutôt que de faire
 * échouer toute la ligne — même philosophie que "une ligne invalide
 * n'interrompt jamais tout l'import" (section 43), étendue à
 * l'intérieur même d'une ligne : le produit doit être créé même si une
 * seule de ses cinq photos a un lien cassé.
 */
export const CsvRowSchema = z.object({
  name: z.string().min(1, "name requis"),
  price: z.coerce.number().nonnegative("price doit être un nombre positif"),
  category: z.string().optional(),
  description: z.string().optional(),
  stock: z.coerce.number().nonnegative().optional().default(0),
  status: ProductStatusSchema.optional(),
  /** Une seule image — conservé pour compatibilité, voir image_urls pour plusieurs. */
  image_url: z.string().optional(),
  /** Catalogue V2 — plusieurs images séparées par "|". Prioritaire sur image_url si les deux sont renseignées. */
  image_urls: z.string().optional(),
  /** Catalogue V2 — "Libellé:Valeur|Libellé2:Valeur2", 12 paires maximum. */
  specifications: z.string().optional(),
});

export interface ImportRowResult {
  row: number;
  name: string;
  status: "created" | "failed";
  error?: string;
}

export interface ImportProductsResult {
  totalRows: number;
  created: number;
  failed: number;
  rows: ImportRowResult[];
}

/** Sépare sur "|", nettoie, et ne garde que des URLs http(s) valides — une URL cassée est ignorée, pas bloquante pour le reste de la ligne. */
export function parseImageUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  const httpUrl = z.string().url();
  return raw
    .split("|")
    .map((u) => u.trim())
    .filter((u) => u.length > 0 && httpUrl.safeParse(u).success);
}

/** `image_urls` (plusieurs) est prioritaire ; `image_url` (une seule, historique) sert de repli. */
export function resolveImageUrls(data: { image_url?: string; image_urls?: string }): string[] {
  if (data.image_urls) return parseImageUrls(data.image_urls);
  if (data.image_url) return parseImageUrls(data.image_url);
  return [];
}

/** "Libellé:Valeur|Libellé2:Valeur2" -> paires validées (CatalogSpecificationSchema), une paire mal formée est ignorée plutôt que de faire échouer les autres. Plafonné à 12, comme CatalogSpecificationsSchema. */
export function parseSpecifications(raw: string | undefined): CatalogSpecification[] {
  if (!raw) return [];
  const valid: CatalogSpecification[] = [];
  for (const entry of raw.split("|")) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex === -1) continue;
    const candidate = {
      label: entry.slice(0, separatorIndex).trim(),
      value: entry.slice(separatorIndex + 1).trim(),
    };
    const parsed = CatalogSpecificationSchema.safeParse(candidate);
    if (parsed.success) valid.push(parsed.data);
    if (valid.length >= 12) break;
  }
  return valid;
}

/**
 * Section 43 : une ligne invalide ne doit JAMAIS interrompre tout l'import
 * (le commerçant a 100 lignes, une erreur sur la ligne 42 ne doit pas
 * perdre les 41 déjà traitées). Chaque ligne est indépendante.
 */
export async function importProductsFromCsv(
  organizationId: string,
  csvText: string,
  actorUserId?: string,
): Promise<ImportProductsResult> {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new ValidationError(`CSV illisible: ${parsed.errors[0]?.message ?? "format invalide"}`);
  }

  const supabase = getSupabaseServiceClient();
  const rows: ImportRowResult[] = [];

  // Cache des catégories déjà résolues/créées pendant cet import, pour
  // éviter de recréer "Chaussures" 100 fois sur 100 lignes.
  const categoryCache = new Map<string, string>();

  async function resolveCategoryId(name: string): Promise<string> {
    const key = name.trim().toLowerCase();
    if (categoryCache.has(key)) return categoryCache.get(key)!;
    const id = await findOrCreateCategory(organizationId, name);
    categoryCache.set(key, id);
    return id;
  }

  for (let i = 0; i < parsed.data.length; i++) {
    const rawRow = parsed.data[i];
    const rowNumber = i + 2; // +1 header, +1 pour un numéro de ligne 1-based lisible

    if (!rawRow) continue; // ligne vide déjà filtrée normalement par skipEmptyLines, filet de sécurité

    const validation = CsvRowSchema.safeParse(rawRow);
    if (!validation.success) {
      rows.push({
        row: rowNumber,
        name: rawRow.name ?? "(sans nom)",
        status: "failed",
        error: validation.error.issues.map((issue) => issue.message).join("; "),
      });
      continue;
    }

    const data = validation.data;

    try {
      const catalogEntitlement = await canUseFeature(organizationId, "catalog_products", 1);
      if (!catalogEntitlement.allowed) {
        throw new QuotaExceededError(`La limite de ${catalogEntitlement.limit.toLocaleString("fr-FR")} produits de votre offre est atteinte.`);
      }

      const categoryId = data.category ? await resolveCategoryId(data.category) : null;
      const status = data.status ?? (data.stock > 0 ? "active" : "draft");
      const specifications = parseSpecifications(data.specifications);

      const { data: product, error: productError } = await supabase
        .from("products")
        .insert({
          organization_id: organizationId,
          name: data.name,
          slug: `${slugify(data.name)}-${Math.random().toString(36).slice(2, 7)}`,
          description: data.description ?? null,
          category_id: categoryId,
          unit_price: data.price,
          current_stock: data.stock,
          status,
          specifications: specifications.length > 0 ? specifications : null,
        })
        .select("id")
        .single();

      if (productError || !product) {
        throw new Error(productError?.message ?? "insert failed");
      }

      const imageUrls = resolveImageUrls(data);
      if (imageUrls.length > 0) {
        await supabase.from("product_images").insert(
          imageUrls.map((url, index) => ({
            organization_id: organizationId,
            product_id: product.id,
            url,
            position: index,
          })),
        );
      }

      await supabase.from("audit_logs").insert({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        action: "PRODUCT_IMPORTED_CSV",
        entity_type: "product",
        entity_id: product.id,
        after_state: { name: data.name, price: data.price },
      });

      rows.push({ row: rowNumber, name: data.name, status: "created" });
    } catch (rowError) {
      rows.push({
        row: rowNumber,
        name: data.name,
        status: "failed",
        error: rowError instanceof Error ? rowError.message : String(rowError),
      });
    }
  }

  const created = rows.filter((r) => r.status === "created").length;

  return {
    totalRows: rows.length,
    created,
    failed: rows.length - created,
    rows,
  };
}
