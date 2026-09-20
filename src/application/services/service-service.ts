import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { findOrCreateCategory, resolvePrimaryImageUrl } from "./catalog-service";
import { slugify, CatalogSpecificationsSchema, type CatalogSpecification } from "@/domain/entities/catalog";
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
  categoryId: string | null;
  /** Catalogue V2 (0056) — photo de position la plus basse (service_images), ou null si aucune. Parité avec CatalogProductSummary.imageUrl. */
  imageUrl: string | null;
}

export interface ServiceForEdit extends ServiceListItem {
  description: string | null;
  /** Catalogue V2 (0056) — jamais undefined : [] si aucune configurée. */
  specifications: CatalogSpecification[];
}

interface ServiceRow {
  id: string;
  name: string;
  description?: string | null;
  price: number | string;
  duration_minutes: number | null;
  status: string;
  category_id: string | null;
  categories?: { name?: string | null } | null;
  service_images?: { url: string; position: number }[];
  specifications?: CatalogSpecification[] | null;
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
    categoryId: row.category_id,
    imageUrl: resolvePrimaryImageUrl(row.service_images),
    specifications: row.specifications ?? [],
  };
}

export async function listServicesForOrg(organizationId: string): Promise<ServiceListItem[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .select("id, name, price, duration_minutes, status, category_id, categories(name), service_images(url, position)")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) throw new Error(`Erreur lecture des services: ${error.message}`);
  return ((data ?? []) as unknown as ServiceRow[]).map(mapServiceRow);
}

export async function getServiceForEdit(organizationId: string, serviceId: string): Promise<ServiceForEdit> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, description, price, duration_minutes, status, category_id, specifications, categories(name), service_images(url, position)",
    )
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
  /** Réservé à un éventuel import en masse — voir la note équivalente de
   * `CreateProductInput` (catalog-service.ts). Le formulaire dashboard
   * doit utiliser `categoryId`. */
  categoryName?: string;
  /** Id d'une catégorie existante — prioritaire sur `categoryName`. */
  categoryId?: string;
  price: number;
  durationMinutes?: number | null;
  status?: ServiceStatus;
  /** Catalogue V2 (0056) — URL finale déjà résolue (upload ou lien direct, voir media-service.ts). Parité avec CreateProductInput.imageUrl. */
  imageUrl?: string;
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
  const categoryId =
    input.categoryId !== undefined
      ? input.categoryId || null
      : input.categoryName
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

  if (input.imageUrl) {
    await appendServiceImage(input.organizationId, data.id, input.imageUrl);
  }

  return { serviceId: data.id };
}

export interface UpdateServiceInput {
  name: string;
  description?: string;
  categoryName?: string;
  categoryId?: string;
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
  const categoryId =
    input.categoryId !== undefined
      ? input.categoryId || null
      : input.categoryName
        ? await findOrCreateCategory(organizationId, input.categoryName)
        : null;

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

// ---------------------------------------------------------------------------
// Catalogue V2 (0056) — galerie multi-photos, en miroir exact de
// catalog-service.ts (listProductImages/appendProductImage/
// removeProductImage/moveProductImage/setPrimaryProductImage), table
// `service_images` au lieu de `product_images`. Écart identifié par audit
// du code réel (pas seulement du schéma) : `services` n'avait jusqu'ici
// AUCUNE image, nulle part — ni table, ni champ de formulaire, ni galerie
// côté dashboard, ni photo sur la fiche prestation publique — alors que
// les produits en ont une depuis 0008_catalog_faq_business.sql. Un salon
// de coiffure ou un cabinet de conseil ne pouvait illustrer aucune de ses
// prestations, contrairement à un commerçant retail pour chaque produit.
// ---------------------------------------------------------------------------

export interface ServiceImageItem {
  id: string;
  url: string;
  position: number;
}

/** Galerie complète d'un service, triée par position — position 0 = photo principale (site public, WhatsApp, publications). */
export async function listServiceImages(organizationId: string, serviceId: string): Promise<ServiceImageItem[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("service_images")
    .select("id, url, position")
    .eq("organization_id", organizationId)
    .eq("service_id", serviceId)
    .order("position", { ascending: true });

  if (error) throw new Error(`Erreur lecture des photos du service ${serviceId}: ${error.message}`);
  return data ?? [];
}

/** Ajoute une photo à la FIN de la galerie (jamais en position 0 — n'écrase jamais la photo principale existante). */
export async function appendServiceImage(organizationId: string, serviceId: string, url: string): Promise<void> {
  const existing = await listServiceImages(organizationId, serviceId);
  const nextPosition = existing.length > 0 ? Math.max(...existing.map((i) => i.position)) + 1 : 0;

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("service_images")
    .insert({ organization_id: organizationId, service_id: serviceId, url, position: nextPosition });

  if (error) throw new Error(`Impossible d'ajouter la photo: ${error.message}`);
}

/** Version plurielle — voir catalog-service.ts::appendProductImages (même correctif, même raisonnement). */
export async function appendServiceImages(organizationId: string, serviceId: string, urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const existing = await listServiceImages(organizationId, serviceId);
  const startPosition = existing.length > 0 ? Math.max(...existing.map((i) => i.position)) + 1 : 0;

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("service_images").insert(
    urls.map((url, index) => ({
      organization_id: organizationId,
      service_id: serviceId,
      url,
      position: startPosition + index,
    })),
  );

  if (error) throw new Error(`Impossible d'ajouter les photos: ${error.message}`);
}

/** Referme l'écart des positions (toujours 0,1,2... contigu) après une suppression — voir catalog-service.ts::renumberProductImages. */
async function renumberServiceImages(organizationId: string, serviceId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const images = await listServiceImages(organizationId, serviceId);
  const updates = images
    .map((img, correctPosition) => ({ img, correctPosition }))
    .filter(({ img, correctPosition }) => img.position !== correctPosition);

  await Promise.all(
    updates.map(({ img, correctPosition }) =>
      supabase.from("service_images").update({ position: correctPosition }).eq("id", img.id),
    ),
  );
}

export async function removeServiceImage(organizationId: string, serviceId: string, imageId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("service_images")
    .delete()
    .eq("id", imageId)
    .eq("organization_id", organizationId)
    .eq("service_id", serviceId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Impossible de supprimer la photo: ${error.message}`);
  if (!data) throw new NotFoundError("Photo introuvable.");

  await renumberServiceImages(organizationId, serviceId);
}

/** Échange la position de deux photos adjacentes — voir catalog-service.ts::moveProductImage (même logique, jamais de drag-and-drop). */
export async function moveServiceImage(
  organizationId: string,
  serviceId: string,
  imageId: string,
  direction: "up" | "down",
): Promise<void> {
  const images = await listServiceImages(organizationId, serviceId);
  const index = images.findIndex((img) => img.id === imageId);
  if (index === -1) throw new NotFoundError("Photo introuvable.");

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= images.length) return;

  const current = images[index]!;
  const swapWith = images[swapIndex]!;

  const supabase = getSupabaseServiceClient();
  await Promise.all([
    supabase.from("service_images").update({ position: swapWith.position }).eq("id", current.id),
    supabase.from("service_images").update({ position: current.position }).eq("id", swapWith.id),
  ]);
}

/** Bascule une photo en position 0 (principale) en l'échangeant avec l'actuelle principale — jamais un delete+reinsert. */
export async function setPrimaryServiceImage(
  organizationId: string,
  serviceId: string,
  imageId: string,
): Promise<void> {
  const images = await listServiceImages(organizationId, serviceId);
  const target = images.find((img) => img.id === imageId);
  if (!target) throw new NotFoundError("Photo introuvable.");
  if (target.position === 0) return;

  const currentPrimary = images.find((img) => img.position === 0);
  const supabase = getSupabaseServiceClient();

  await supabase.from("service_images").update({ position: 0 }).eq("id", target.id);
  if (currentPrimary) {
    await supabase.from("service_images").update({ position: target.position }).eq("id", currentPrimary.id);
  }
}

// ---------------------------------------------------------------------------
// Catalogue V2 (0056) — "informations complémentaires", en miroir exact de
// catalog-service.ts (listProductSpecifications/addProductSpecification/
// removeProductSpecification). Voir le commentaire de la migration 0056
// pour pourquoi c'est une liste libre plutôt que des colonnes par secteur.
// ---------------------------------------------------------------------------

async function readServiceSpecifications(organizationId: string, serviceId: string): Promise<CatalogSpecification[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .select("specifications")
    .eq("id", serviceId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture des informations complémentaires du service ${serviceId}: ${error.message}`);
  if (!data) throw new NotFoundError("Service introuvable.");
  return (data as unknown as { specifications?: CatalogSpecification[] | null }).specifications ?? [];
}

export async function listServiceSpecifications(organizationId: string, serviceId: string): Promise<CatalogSpecification[]> {
  return readServiceSpecifications(organizationId, serviceId);
}

export async function addServiceSpecification(
  organizationId: string,
  serviceId: string,
  label: string,
  value: string,
): Promise<void> {
  const existing = await readServiceSpecifications(organizationId, serviceId);
  const parsed = CatalogSpecificationsSchema.safeParse([...existing, { label, value }]);
  if (!parsed.success) {
    throw new ValidationError(
      "Informations invalides : libellé et valeur obligatoires (12 lignes maximum au total).",
    );
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("services")
    .update({ specifications: parsed.data })
    .eq("id", serviceId)
    .eq("organization_id", organizationId);

  if (error) throw new Error(`Impossible d'ajouter l'information: ${error.message}`);
}

export async function removeServiceSpecification(
  organizationId: string,
  serviceId: string,
  index: number,
): Promise<void> {
  const existing = await readServiceSpecifications(organizationId, serviceId);
  const next = existing.filter((_, i) => i !== index);

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("services")
    .update({ specifications: next })
    .eq("id", serviceId)
    .eq("organization_id", organizationId);

  if (error) throw new Error(`Impossible de supprimer l'information: ${error.message}`);
}
