import type { StorageProvider, UploadFileRequest } from "@/domain/ports/storage-provider";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Bucket unique pour tous les médias tenant (produits, logo, bannière,
 * favicon). Créé par la migration `0013_storage_tenant_media_bucket.sql`.
 * Un seul bucket + préfixe organizationId, plutôt qu'un bucket par tenant
 * (section 62 : ne pas sur-engineer — un bucket par tenant n'apporterait
 * rien de plus tant qu'aucun besoin de quota/permissions par bucket
 * n'existe réellement).
 */
const BUCKET = "tenant-media";

/**
 * Préfixe TOUJOURS le chemin par l'organizationId (isolation tenant même
 * dans le stockage de fichiers, cahier Lot E Partie 1). Idempotent : si
 * l'appelant a déjà stocké/reçu un chemin préfixé (ex: valeur retournée par
 * `upload()` et réutilisée telle quelle pour un `delete()` plus tard), on
 * ne double-préfixe pas.
 */
function toObjectPath(organizationId: string, path: string): string {
  return path.startsWith(`${organizationId}/`) ? path : `${organizationId}/${path}`;
}

/**
 * SupabaseStorageAdapter — implémentation concrète V1 du port
 * StorageProvider (cahier Lot E Partie 1). Utilise le client service-role
 * (comme les autres adapters du registry) : l'isolation tenant n'est donc
 * PAS garantie par RLS ici mais par le préfixage explicite du chemin +
 * `requireMembership` en amont dans les Server Actions appelantes (double
 * barrière, voir 00_CONVENTIONS_COMMUNES.md). Les policies RLS sur
 * `storage.objects` (migration 0013) restent en filet de sécurité pour
 * tout accès qui passerait un jour par un client scopé utilisateur.
 */
export class SupabaseStorageAdapter implements StorageProvider {
  readonly providerName = "supabase";

  async upload(request: UploadFileRequest): Promise<{ url: string; path: string }> {
    const supabase = getSupabaseServiceClient();
    const objectPath = toObjectPath(request.organizationId, request.path);

    const { error } = await supabase.storage.from(BUCKET).upload(objectPath, request.data, {
      contentType: request.contentType,
      upsert: false,
    });

    if (error) {
      throw new Error(`Échec de l'upload du fichier (${objectPath}): ${error.message}`);
    }

    const url = await this.getUrl(request.organizationId, request.path);
    return { url, path: objectPath };
  }

  async delete(organizationId: string, path: string): Promise<void> {
    const supabase = getSupabaseServiceClient();
    const objectPath = toObjectPath(organizationId, path);

    const { error } = await supabase.storage.from(BUCKET).remove([objectPath]);
    if (error) {
      throw new Error(`Échec de la suppression du fichier (${objectPath}): ${error.message}`);
    }
  }

  async getUrl(organizationId: string, path: string): Promise<string> {
    const supabase = getSupabaseServiceClient();
    const objectPath = toObjectPath(organizationId, path);

    // Bucket public (migration 0013) : URL publique directe, pas de sign
    // nécessaire — cohérent avec l'usage (logo/bannière/favicon/photos
    // produit sont déjà publics sur la vitrine, section 12).
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
    return data.publicUrl;
  }
}
