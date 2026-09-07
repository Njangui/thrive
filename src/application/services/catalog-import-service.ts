import Papa from "papaparse";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { slugify, ProductStatusSchema } from "@/domain/entities/catalog";
import { findOrCreateCategory } from "./catalog-service";
import { ValidationError } from "@/lib/errors";

/**
 * Colonnes CSV attendues (section 11) : name, price, category, description,
 * stock, status. `image_url` est une extension raisonnable (une seule image
 * principale) pour ne pas laisser "la gestion des images" totalement de
 * côté, sans construire un système d'upload multi-images complexe en V1.
 */
export const CsvRowSchema = z.object({
  name: z.string().min(1, "name requis"),
  price: z.coerce.number().nonnegative("price doit être un nombre positif"),
  category: z.string().optional(),
  description: z.string().optional(),
  stock: z.coerce.number().nonnegative().optional().default(0),
  status: ProductStatusSchema.optional(),
  image_url: z.string().url().optional(),
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
      const categoryId = data.category ? await resolveCategoryId(data.category) : null;
      const status = data.status ?? (data.stock > 0 ? "active" : "draft");

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
        })
        .select("id")
        .single();

      if (productError || !product) {
        throw new Error(productError?.message ?? "insert failed");
      }

      if (data.image_url) {
        await supabase.from("product_images").insert({
          organization_id: organizationId,
          product_id: product.id,
          url: data.image_url,
          position: 0,
        });
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
