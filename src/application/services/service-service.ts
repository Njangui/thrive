import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { findOrCreateCategory } from "./catalog-service";
import { slugify } from "@/domain/entities/catalog";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Lot 2 (master prompt §17) — le backend contenait déjà la table
 * `services` (0008_catalog_faq_business.sql : name/slug/description/
 * category_id/price/duration_minutes/status) mais AUCUN fichier ne
 * l'écrivait jamais (recherché dans tout `src/` : seul
 * landing-config-service.ts::listActiveServicesForStorefront la
 * LISAIT, pour la vitrine publique). Un commerçant ne pouvait donc
 * jamais créer un service — ce fichier comble ce trou.
 *
 * Réutilise `findOrCreateCategory`/`slugify` (catalog-service.ts) : les
 * catégories sont partagées entre produits et services (schéma), une
 * seule fonction pour les résoudre (section 100 : pas de logique
 * dupliquée).
 *
 * `status` réutilise l'enum `product_status` du schéma (draft/active/
 * out_of_stock/inactive) pour éviter un second type — mais
 * `out_of_stock` n'a pas de sens pour un service (pas de notion de
 * stock) : volontairement jamais proposé dans `SERVICE_STATUSES`
 * ci-dessous ni dans l'UI, seulement `draft`/`active`/`inactive`.
 *
 * Pas de suppression définitive (`deleteService`) — même convention que
 * `products` (catalog-service.ts n'expose lui non plus aucune fonction
 * de suppression, seulement un changement de statut). Cohérence
 * délibérée avec l'entité la plus proche du schéma plutôt qu'une
 * suppression dure introduite ponctuellement pour les seuls services.
 */

export const SERVICE_STATUSES = ["draft", "active", "inactive"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export interface ServiceListItem {
  id: string;
  name: string;
  price: number;
  durationMinutes: number | null;
  status: string;
  categoryName: string | null;
}

export interface ServiceForEdit extends ServiceListItem {
  description: string | null;
}

interface ServiceRow {
  id: string;
  name: string;
  description?: string | null;
  price: number | string;
  duration_minutes: number | null;
  status: string;
  categories?: { name?: string | null } | null;
}

function mapServiceRow(row: ServiceRow): ServiceForEdit {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    price: Number(row.price),
    durationMinutes: row.duration_minutes,
    status: row.status,
    categoryName: row.categories?.name ?? null,
  };
}

export async function listServicesForOrg(organizationId: string): Promise<ServiceListItem[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .select("id, name, price, duration_minutes, status, categories(name)")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) throw new Error(`Erreur lecture des services: ${error.message}`);
  return ((data ?? []) as unknown as ServiceRow[]).map(mapServiceRow);
}

export async function getServiceForEdit(organizationId: string, serviceId: string): Promise<ServiceForEdit> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .select("id, name, description, price, duration_minutes, status, categories(name)")
    .eq("id", serviceId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture service ${serviceId}: ${error.message}`);
  if (!data) throw new NotFoundError("Service introuvable.");

  return mapServiceRow(data as unknown as ServiceRow);
}

export interface CreateServiceInput {
  organizationId: string;
  name: string;
  description?: string;
  categoryName?: string;
  price: number;
  durationMinutes?: number | null;
  status?: ServiceStatus;
}

function assertValidServiceInput(name: string, price: number, durationMinutes?: number | null): void {
  if (!name.trim()) throw new ValidationError("Le nom du service est obligatoire.");
  if (!Number.isFinite(price) || price < 0) throw new ValidationError("Le prix doit être un nombre positif.");
  if (durationMinutes != null && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
    throw new ValidationError("La durée doit être un nombre de minutes positif.");
  }
}

export async function createService(input: CreateServiceInput): Promise<{ serviceId: string }> {
  assertValidServiceInput(input.name, input.price, input.durationMinutes);

  const supabase = getSupabaseServiceClient();
  const categoryId = input.categoryName
    ? await findOrCreateCategory(input.organizationId, input.categoryName)
    : null;
  const slug = `${slugify(input.name)}-${Math.random().toString(36).slice(2, 7)}`;

  const { data, error } = await supabase
    .from("services")
    .insert({
      organization_id: input.organizationId,
      name: input.name.trim(),
      slug,
      description: input.description?.trim() || null,
      category_id: categoryId,
      price: input.price,
      duration_minutes: input.durationMinutes ?? null,
      status: input.status ?? "active",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Impossible de créer le service: ${error?.message}`);
  }
  return { serviceId: data.id };
}

export interface UpdateServiceInput {
  name: string;
  description?: string;
  categoryName?: string;
  price: number;
  durationMinutes?: number | null;
  status?: ServiceStatus;
}

export async function updateService(
  serviceId: string,
  organizationId: string,
  input: UpdateServiceInput,
): Promise<void> {
  assertValidServiceInput(input.name, input.price, input.durationMinutes);

  const supabase = getSupabaseServiceClient();
  const categoryId = input.categoryName ? await findOrCreateCategory(organizationId, input.categoryName) : null;

  const updatePayload: Record<string, unknown> = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    category_id: categoryId,
    price: input.price,
    duration_minutes: input.durationMinutes ?? null,
  };
  // Même règle qu'updateProduct (catalog-service.ts) : un statut omis ne
  // touche jamais la colonne, pour ne jamais réactiver/désactiver un
  // service par effet de bord d'un update partiel.
  if (input.status !== undefined) updatePayload.status = input.status;

  const { data, error } = await supabase
    .from("services")
    .update(updatePayload)
    .eq("id", serviceId)
    .eq("organization_id", organizationId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Impossible de mettre à jour le service ${serviceId}: ${error.message}`);
  if (!data) throw new NotFoundError("Service introuvable.");
}

/** Bascule active ⇄ inactive — action rapide de la liste (pas de champ status à part entière à remplir). */
export async function toggleServiceStatus(
  serviceId: string,
  organizationId: string,
  newStatus: ServiceStatus,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .update({ status: newStatus })
    .eq("id", serviceId)
    .eq("organization_id", organizationId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Impossible de changer le statut du service ${serviceId}: ${error.message}`);
  if (!data) throw new NotFoundError("Service introuvable.");
}
