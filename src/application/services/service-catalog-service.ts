import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { slugify } from "@/domain/entities/catalog";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Lot 3 (audit master prompt §17) — la table `services` existe depuis
 * 0008_catalog_faq_business.sql (RLS déjà en place, "members can access
 * services of their org" for all), mais n'avait jusqu'ici aucune couche
 * applicative : ni service métier, ni page dashboard, ni intégration au
 * router IA (voir conversation-orchestrator.ts). Ce fichier comble le
 * premier point, en miroir direct de catalog-service.ts pour les
 * produits — même discipline (slug unique, statut dérivé, RLS comme
 * seule barrière DB, application layer pour la validation).
 *
 * Volontairement plus simple que catalog-service.ts : pas d'image (le
 * cahier §17 la note "si utile", pas requise), pas de stock (une
 * prestation n'a pas de quantité), pas d'import CSV (périmètre non
 * demandé pour ce lot — un service à la fois suffit pour un catalogue de
 * prestations, généralement bien plus court qu'un catalogue produits).
 */

export interface ServiceSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  categoryName: string | null;
  priceFcfa: number;
  durationMinutes: number | null;
  status: "draft" | "active" | "inactive" | "out_of_stock";
}

function mapServiceRow(row: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  duration_minutes: number | null;
  status: string;
  categories?: { name?: string } | null;
}): ServiceSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    categoryName: row.categories?.name ?? null,
    priceFcfa: Number(row.price),
    durationMinutes: row.duration_minutes,
    status: row.status as ServiceSummary["status"],
  };
}

export async function listServices(organizationId: string, includeInactive = true): Promise<ServiceSummary[]> {
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("services")
    .select("id, name, slug, description, price, duration_minutes, status, categories(name)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (!includeInactive) query = query.eq("status", "active");

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture prestations: ${error.message}`);

  return (data ?? []).map((r) => mapServiceRow(r as unknown as Parameters<typeof mapServiceRow>[0]));
}

/**
 * Recherche simple par nom (même discipline que
 * catalog-service.ts::searchProductsByName — ilike, pas de recherche
 * sémantique en V1, "règles avant IA"). Utilisée par le router IA pour
 * répondre aux questions sur une prestation sans jamais appeler l'IA.
 */
export async function searchServicesByName(organizationId: string, query: string, limit = 3): Promise<ServiceSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .select("id, name, slug, description, price, duration_minutes, status, categories(name)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .ilike("name", `%${query}%`)
    .limit(limit);

  if (error) throw new Error(`Erreur recherche prestations: ${error.message}`);
  return (data ?? []).map((r) => mapServiceRow(r as unknown as Parameters<typeof mapServiceRow>[0]));
}

/**
 * Réponse structurée pour le router IA (même forme que
 * catalog-service.ts::formatProductDiscoveryMessage) — jamais l'IA pour
 * une information déjà connue de façon fiable (section 26/29 du master
 * prompt).
 */
export function formatServiceDiscoveryMessage(services: ServiceSummary[]): string {
  if (services.length === 0) return "Nous n'avons pas encore de prestation correspondante à vous proposer.";

  return services
    .map((s) => {
      const parts = [
        s.name,
        `${s.priceFcfa.toLocaleString("fr-FR")} FCFA`,
        s.durationMinutes ? `${s.durationMinutes} min` : null,
        s.description ?? null,
      ].filter(Boolean);
      return `• ${parts.join(" — ")}`;
    })
    .join("\n");
}

async function findOrCreateCategory(organizationId: string, categoryName: string): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const slug = slugify(categoryName);

  const { data: existing } = await supabase
    .from("categories")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("categories")
    .insert({ organization_id: organizationId, name: categoryName, slug })
    .select("id")
    .single();

  if (error || !created) throw new Error(`Impossible de créer la catégorie: ${error?.message}`);
  return created.id;
}

export interface CreateServiceInput {
  organizationId: string;
  name: string;
  description?: string;
  categoryName?: string;
  priceFcfa: number;
  durationMinutes?: number;
}

export async function createService(input: CreateServiceInput): Promise<{ serviceId: string }> {
  if (!input.name.trim()) throw new ValidationError("Le nom de la prestation est requis.");
  if (input.priceFcfa < 0) throw new ValidationError("Le prix doit être positif.");

  const supabase = getSupabaseServiceClient();
  const categoryId = input.categoryName ? await findOrCreateCategory(input.organizationId, input.categoryName) : null;
  const slug = `${slugify(input.name)}-${Math.random().toString(36).slice(2, 7)}`;

  const { data, error } = await supabase
    .from("services")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      slug,
      description: input.description ?? null,
      category_id: categoryId,
      price: input.priceFcfa,
      duration_minutes: input.durationMinutes ?? null,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Impossible de créer la prestation: ${error?.message}`);
  return { serviceId: data.id };
}

export interface UpdateServiceInput {
  name?: string;
  description?: string;
  priceFcfa?: number;
  durationMinutes?: number;
  status?: "active" | "inactive" | "draft";
}

export async function updateService(organizationId: string, serviceId: string, input: UpdateServiceInput): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new ValidationError("Le nom de la prestation est requis.");
    patch.name = input.name;
  }
  if (input.description !== undefined) patch.description = input.description || null;
  if (input.priceFcfa !== undefined) {
    if (input.priceFcfa < 0) throw new ValidationError("Le prix doit être positif.");
    patch.price = input.priceFcfa;
  }
  if (input.durationMinutes !== undefined) patch.duration_minutes = input.durationMinutes || null;
  if (input.status !== undefined) patch.status = input.status;

  const supabase = getSupabaseServiceClient();
  const { error, count } = await supabase
    .from("services")
    .update(patch, { count: "exact" })
    .eq("id", serviceId)
    .eq("organization_id", organizationId);

  if (error) throw new Error(`Impossible de mettre à jour la prestation: ${error.message}`);
  if (!count) throw new NotFoundError("Prestation introuvable.");
}

export async function deleteService(organizationId: string, serviceId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error, count } = await supabase
    .from("services")
    .delete({ count: "exact" })
    .eq("id", serviceId)
    .eq("organization_id", organizationId);

  if (error) throw new Error(`Impossible de supprimer la prestation: ${error.message}`);
  if (!count) throw new NotFoundError("Prestation introuvable.");
}
