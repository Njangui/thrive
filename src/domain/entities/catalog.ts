import { z } from "zod";

export const ProductStatusSchema = z.enum(["draft", "active", "out_of_stock", "inactive"]);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const ProductSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  slug: z.string().nullable(),
  description: z.string().nullable(),
  categoryId: z.string().uuid().nullable(),
  unitPrice: z.number(),
  compareAtPrice: z.number().nullable(),
  currentStock: z.number(),
  minStock: z.number(),
  status: ProductStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Product = z.infer<typeof ProductSchema>;

export const CategorySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

export type Category = z.infer<typeof CategorySchema>;

export const ServiceSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  categoryId: z.string().uuid().nullable(),
  price: z.number(),
  durationMinutes: z.number().nullable(),
  status: ProductStatusSchema,
});

export type Service = z.infer<typeof ServiceSchema>;

/**
 * Utilitaire de slug — utilisé à la création d'un produit/service pour
 * garantir une URL publique stable (section 40 : ne pas casser les
 * anciennes URLs si le nom change — le slug n'est PAS régénéré à chaque
 * update, seulement à la création ou sur demande explicite).
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
