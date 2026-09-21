import { TELEGRAM_UPLOAD_MAX_BYTES } from "@/lib/remote-media";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { isFeatureEnabled } from "./entitlements-service";
import { ZernioSocialClient } from "@/infrastructure/providers/social/zernio/client";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Vidéos du catalogue (produits, services, boutique).
 *
 * Les fichiers sont hébergés chez Zernio (URL présignée) — pas dans Supabase
 * Storage (bucket plafonné à 5 Mo, corps de requête Vercel ≤ 4,5 Mo). Zernio
 * ne les conserve que 7 JOURS : tout ce fichier tourne autour de cette
 * échéance (`expires_at`, voir 0059_catalog_videos.sql).
 *
 * FAITS VÉRIFIÉS dans la doc Zernio (guide « Media Uploads », glossaire,
 * « Get upload URL »), sept. 2026 :
 *  - « Uploads expire after 7 days » — stockage temporaire (`media.zernio.com/temp/…`) ;
 *  - Zernio recommande de « programmer les publications qui utilisent un
 *    upload dans les 7 jours suivant l'envoi » — c'est exactement le garde-fou
 *    `assertVideoAvailableForPublication` ci-dessous ;
 *  - quand une publication qui référence l'URL est publiée, Zernio COPIE le
 *    fichier vers un stockage permanent — pour la publication. La doc ne dit
 *    pas que l'URL temporaire reste valable au-delà de 7 jours : par prudence
 *    on la considère indisponible à l'échéance, publiée ou non ;
 *  - taille : jusqu'à 5 Go via presign, mais au-delà de 200 Mo Zernio ne
 *    garantit plus la compression aux limites de chaque réseau ;
 *  - Telegram (Bot API) : un fichier envoyé PAR URL est limité à 20 Mo ; par
 *    téléversement, 50 Mo. Zernio ne publie pas sur Telegram/YouTube : notre
 *    serveur relit donc la vidéo chez Zernio au moment voulu puis la publie
 *    lui-même (voir lib/remote-media.ts et l'adaptateur Telegram).
 */

/** Durée de conservation des fichiers chez Zernio (stockage temporaire). Seule source de vérité. */
export const VIDEO_RETENTION_DAYS = 7;
export const VIDEO_RETENTION_MS = VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Marge avant l'échéance : une publication programmée trop près de la
 * suppression risquerait de partir alors que Zernio a déjà retiré le
 * fichier (horloges, file de publication, retries).
 */
export const PUBLICATION_SAFETY_MARGIN_MS = 30 * 60 * 1000;

/** MP4 et MOV : les deux formats acceptés par TOUS les canaux visés (YouTube, TikTok, Instagram, Facebook, Telegram). */
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;
/** 200 Mo : au-delà, Zernio « peut ne pas » compresser la vidéo aux limites de chaque plateforme (doc « Media Uploads »). */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/**
 * Telegram (Bot API) : notre serveur relit la vidéo chez Zernio puis la
 * TÉLÉVERSE — plafond 50 Mo (l'envoi par URL, lui, n'irait que jusqu'à 20 Mo).
 */
export { TELEGRAM_UPLOAD_MAX_BYTES };

const ZERNIO_MEDIA_HOST = "media.zernio.com";

export interface CatalogVideo {
  id: string;
  productId: string | null;
  serviceId: string | null;
  title: string | null;
  url: string;
  contentType: string;
  sizeBytes: number | null;
  uploadedAt: string;
  expiresAt: string;
  /** Lot O : `permanent` si Zernio a confirmé un stockage permanent ; `temporary` (7 jours) sinon. */
  storageClass: VideoStorageClass;
  retentionDays: number | null;
  expired: boolean;
}

// ---------------------------------------------------------------------------
// Fonctions pures (testées en isolation)
// ---------------------------------------------------------------------------

export function computeVideoExpiry(uploadedAt: Date): Date {
  return new Date(uploadedAt.getTime() + VIDEO_RETENTION_MS);
}

export type VideoStorageClass = "temporary" | "permanent";

/**
 * Lot O — stockage RÉELLEMENT obtenu chez Zernio, déduit de la réponse (jamais
 * d'une valeur envoyée par le navigateur). Le stockage temporaire vit sous
 * `temp/` (`media.zernio.com/temp/…`, doc Zernio « Media Uploads ») ; un fichier
 * hors de ce préfixe, ou explicitement marqué permanent, est permanent.
 */
export function detectVideoStorageClass(publicUrl: string, storageKey?: string | null, permanentFlag?: boolean): VideoStorageClass {
  if (permanentFlag === true) return "permanent";
  if (permanentFlag === false) return "temporary";
  const isTemp = /(^|\/)temp\//.test(storageKey ?? "") || /\/temp\//.test(publicUrl);
  return isTemp ? "temporary" : "permanent";
}

/** Jours de conservation effectifs : plan (`video_retention_days`) si permanent, sinon 7 jours (stockage temporaire). */
export function effectiveRetentionDays(storageClass: VideoStorageClass, planDays: number): number {
  if (storageClass === "temporary") return VIDEO_RETENTION_DAYS;
  if (planDays === -1) return 365;
  return planDays > 0 ? planDays : VIDEO_RETENTION_DAYS;
}

export function computeCatalogVideoExpiry(uploadedAt: Date, retentionDays: number): Date {
  return new Date(uploadedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

export function isVideoExpired(expiresAt: string | Date, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

export function isZernioMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === ZERNIO_MEDIA_HOST;
  } catch {
    return false;
  }
}

export function validateVideoFile(contentType: string, sizeBytes: number): void {
  if (!(ALLOWED_VIDEO_TYPES as readonly string[]).includes(contentType)) {
    throw new ValidationError("Format vidéo non pris en charge. Utilisez un fichier MP4 ou MOV.");
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new ValidationError("Le fichier vidéo est vide.");
  if (sizeBytes > MAX_VIDEO_BYTES) {
    throw new ValidationError(`Vidéo trop lourde (${Math.round(sizeBytes / 1024 / 1024)} Mo) — ${MAX_VIDEO_BYTES / 1024 / 1024} Mo maximum.`);
  }
}

function formatDeadline(date: Date): string {
  return date.toLocaleString("fr-FR", {
    timeZone: "Africa/Douala",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Refuse une publication qui partirait après la suppression du fichier chez
 * Zernio. `publishAt` = date de programmation, ou « maintenant » pour une
 * diffusion immédiate (une vidéo déjà expirée ne peut pas non plus partir).
 */
export function assertVideoAvailableForPublication(
  video: { title: string | null; expiresAt: Date; retentionDays?: number },
  publishAt: Date,
  now: Date = new Date(),
): void {
  const label = video.title ? `« ${video.title} »` : "sélectionnée";

  if (video.expiresAt.getTime() <= now.getTime()) {
    throw new ValidationError(
      `La vidéo ${label} a expiré : cette vidéo n'est conservée que ${video.retentionDays ?? VIDEO_RETENTION_DAYS} jours. Téléversez-la à nouveau.`,
    );
  }
  if (publishAt.getTime() > video.expiresAt.getTime() - PUBLICATION_SAFETY_MARGIN_MS) {
    throw new ValidationError(
      `La vidéo ${label} n'est conservée par Zernio que jusqu'au ${formatDeadline(video.expiresAt)} (${video.retentionDays ?? VIDEO_RETENTION_DAYS} jours après son envoi). ` +
        "Programmez la publication avant cette date, ou téléversez à nouveau la vidéo plus près de la publication.",
    );
  }
}

// ---------------------------------------------------------------------------
// Accès données
// ---------------------------------------------------------------------------

interface CatalogVideoRow {
  id: string;
  product_id: string | null;
  service_id: string | null;
  title: string | null;
  url: string;
  content_type: string;
  size_bytes: number | null;
  uploaded_at: string;
  expires_at: string;
  storage_class?: VideoStorageClass | null;
  retention_days?: number | null;
}

const VIDEO_COLUMNS = "id, product_id, service_id, title, url, content_type, size_bytes, uploaded_at, expires_at, storage_class, retention_days";

function mapVideo(row: CatalogVideoRow, now: Date = new Date()): CatalogVideo {
  return {
    id: row.id,
    productId: row.product_id,
    serviceId: row.service_id,
    title: row.title,
    url: row.url,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
    expiresAt: row.expires_at,
    storageClass: row.storage_class ?? "temporary",
    retentionDays: row.retention_days ?? null,
    expired: isVideoExpired(row.expires_at, now),
  };
}

export interface VideoUploadTicket {
  uploadUrl: string;
  publicUrl: string;
  key: string | null;
  contentType: string;
  /** Stockage annoncé par Zernio pour CE fichier (informatif — recalculé côté serveur à l'enregistrement). */
  storageClass: VideoStorageClass;
}

/** Étape 1 : obtient l'URL présignée. Le navigateur envoie ensuite le fichier DIRECTEMENT à Zernio. */
export async function requestVideoUploadTicket(
  fileName: string,
  contentType: string,
  sizeBytes: number,
): Promise<VideoUploadTicket> {
  validateVideoFile(contentType, sizeBytes);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "video.mp4";
  const presign = await new ZernioSocialClient().createMediaPresign(safeName, contentType, sizeBytes, { permanent: true });
  if (!isZernioMediaUrl(presign.publicUrl)) {
    throw new Error("Zernio a renvoyé une URL publique inattendue.");
  }
  return { uploadUrl: presign.uploadUrl, publicUrl: presign.publicUrl, key: presign.key ?? null, contentType, storageClass: detectVideoStorageClass(presign.publicUrl, presign.key, presign.permanent) };
}

export interface RegisterCatalogVideoInput {
  publicUrl: string;
  storageKey?: string | null;
  contentType: string;
  sizeBytes?: number | null;
  title?: string | null;
  productId?: string | null;
  serviceId?: string | null;
}

/**
 * Message d'erreur si une vidéo du catalogue dépasse ce que Telegram accepte
 * par téléversement (50 Mo), sinon `null`. Fonction pure.
 */
export function telegramVideoLimitMessage(sizeBytes: number | null | undefined): string | null {
  if (!sizeBytes || sizeBytes <= TELEGRAM_UPLOAD_MAX_BYTES) return null;
  return `Telegram n'accepte pas les vidéos de plus de ${TELEGRAM_UPLOAD_MAX_BYTES / 1024 / 1024} Mo (cette vidéo pèse ${Math.round(sizeBytes / 1024 / 1024)} Mo). Publiez-la sur les autres réseaux, ou utilisez une version allégée pour Telegram.`;
}

/** Vérifie la taille d'une vidéo du catalogue (par URL) avant un envoi Telegram. Ne lève pas si l'URL est inconnue. */
export async function telegramVideoLimitErrorForUrl(organizationId: string, url: string): Promise<string | null> {
  const { data } = await getSupabaseServiceClient()
    .from("catalog_videos")
    .select("size_bytes")
    .eq("organization_id", organizationId)
    .eq("url", url)
    .maybeSingle();
  return telegramVideoLimitMessage(data?.size_bytes as number | null | undefined);
}

/** Étape 2 : enregistre la vidéo une fois le `PUT` terminé, avec son échéance (conservation de l'offre si stockage permanent, sinon 7 jours). */
export async function registerCatalogVideo(organizationId: string, input: RegisterCatalogVideoInput): Promise<CatalogVideo> {
  // Seules les URLs Zernio sont acceptées : ce champ alimente un lecteur
  // <video> sur la vitrine publique — jamais une URL arbitraire.
  if (!isZernioMediaUrl(input.publicUrl)) throw new ValidationError("URL de vidéo invalide.");
  validateVideoFile(input.contentType, input.sizeBytes ?? 1);
  if (input.productId && input.serviceId) throw new ValidationError("Une vidéo ne peut être rattachée qu'à un produit OU à un service.");

  const supabase = getSupabaseServiceClient();

  if (input.productId) {
    const { data } = await supabase.from("products").select("id").eq("organization_id", organizationId).eq("id", input.productId).maybeSingle();
    if (!data) throw new NotFoundError("Produit introuvable");
  }
  if (input.serviceId) {
    const { data } = await supabase.from("services").select("id").eq("organization_id", organizationId).eq("id", input.serviceId).maybeSingle();
    if (!data) throw new NotFoundError("Service introuvable");
  }

  // Lot O : conservation selon l'offre (7 / 30 / 90 jours) UNIQUEMENT si Zernio a
  // réellement confirmé un stockage permanent (jamais sur la foi du navigateur).
  const storageClass = detectVideoStorageClass(input.publicUrl, input.storageKey);
  const { limit: planDays } = await isFeatureEnabled(organizationId, "video_retention_days");
  const retentionDays = effectiveRetentionDays(storageClass, planDays);

  const uploadedAt = new Date();
  const { data, error } = await supabase
    .from("catalog_videos")
    .insert({
      organization_id: organizationId,
      product_id: input.productId ?? null,
      service_id: input.serviceId ?? null,
      title: input.title?.trim() || null,
      url: input.publicUrl,
      storage_key: input.storageKey ?? null,
      content_type: input.contentType,
      size_bytes: input.sizeBytes ?? null,
      uploaded_at: uploadedAt.toISOString(),
      expires_at: computeCatalogVideoExpiry(uploadedAt, retentionDays).toISOString(),
      storage_class: storageClass,
      retention_days: storageClass === "permanent" ? retentionDays : null,
    })
    .select(VIDEO_COLUMNS)
    .single();

  if (error || !data) throw new Error(`Enregistrement de la vidéo impossible: ${error?.message ?? "erreur inconnue"}`);
  return mapVideo(data as CatalogVideoRow);
}

export interface ListCatalogVideosOptions {
  productId?: string;
  serviceId?: string;
  includeExpired?: boolean;
  limit?: number;
}

export async function listCatalogVideos(organizationId: string, options: ListCatalogVideosOptions = {}): Promise<CatalogVideo[]> {
  let query = getSupabaseServiceClient()
    .from("catalog_videos")
    .select(VIDEO_COLUMNS)
    .eq("organization_id", organizationId)
    .order("uploaded_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (options.productId) query = query.eq("product_id", options.productId);
  if (options.serviceId) query = query.eq("service_id", options.serviceId);
  if (!options.includeExpired) query = query.gt("expires_at", new Date().toISOString());

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture vidéos: ${error.message}`);
  const now = new Date();
  return ((data ?? []) as CatalogVideoRow[]).map((row) => mapVideo(row, now));
}

export async function deleteCatalogVideo(organizationId: string, videoId: string): Promise<void> {
  // Le fichier chez Zernio n'est pas supprimé explicitement : il disparaît
  // tout seul à l'échéance des 7 jours. On retire seulement la référence.
  const { data, error } = await getSupabaseServiceClient()
    .from("catalog_videos")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", videoId)
    .select("id");
  if (error) throw new Error(`Suppression de la vidéo impossible: ${error.message}`);
  if (!data || data.length === 0) throw new NotFoundError("Vidéo introuvable");
}

/**
 * Vidéos AFFICHABLES sur la vitrine publique : jamais une vidéo expirée (le
 * fichier n'existe plus chez Zernio — le lecteur afficherait une erreur).
 * Ne lève jamais : une panne ici ne doit pas casser une page publique.
 */
export async function listActiveStorefrontVideos(
  organizationId: string,
  options: { productId?: string; serviceId?: string; limit?: number } = {},
): Promise<CatalogVideo[]> {
  try {
    return await listCatalogVideos(organizationId, { ...options, limit: options.limit ?? 6, includeExpired: false });
  } catch (error) {
    console.warn(`[catalog-videos] lecture vitrine impossible (org ${organizationId}):`, error);
    return [];
  }
}

/** Ids des produits ayant au moins une vidéo active — pour le badge « ▶ Vidéo » du catalogue. Ne lève jamais. */
export async function listProductIdsWithActiveVideo(organizationId: string): Promise<Set<string>> {
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("catalog_videos")
      .select("product_id")
      .eq("organization_id", organizationId)
      .not("product_id", "is", null)
      .gt("expires_at", new Date().toISOString());
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((row) => row.product_id as string));
  } catch (error) {
    console.warn(`[catalog-videos] lecture des badges impossible (org ${organizationId}):`, error);
    return new Set();
  }
}

/**
 * Garde-fou de publication : appelée avant toute diffusion/programmation
 * contenant des médias hébergés chez Zernio.
 *  - vidéo connue du catalogue : on compare à SON échéance exacte ;
 *  - URL Zernio inconnue (collée à la main) : on ne connaît pas sa date
 *    d'envoi, mais elle a au plus 7 jours — toute programmation au-delà de
 *    « maintenant + 7 jours » est donc forcément trop tardive.
 */
export async function assertPublicationMediaAvailable(
  organizationId: string,
  mediaUrls: string[],
  publishAt: Date | null,
): Promise<void> {
  const zernioUrls = [...new Set(mediaUrls.filter(isZernioMediaUrl))];
  if (zernioUrls.length === 0) return;

  const { data, error } = await getSupabaseServiceClient()
    .from("catalog_videos")
    .select("title, url, expires_at, retention_days")
    .eq("organization_id", organizationId)
    .in("url", zernioUrls);
  if (error) throw new Error(`Erreur lecture vidéos: ${error.message}`);

  const known = new Map<string, { title: string | null; expires_at: string; retention_days: number | null }>();
  for (const row of data ?? []) known.set(row.url as string, { title: row.title as string | null, expires_at: row.expires_at as string, retention_days: (row.retention_days as number | null) ?? null });
  const now = new Date();
  const at = publishAt ?? now;

  for (const url of zernioUrls) {
    const video = known.get(url);
    if (video) {
      assertVideoAvailableForPublication({ title: video.title, expiresAt: new Date(video.expires_at), retentionDays: video.retention_days ?? undefined }, at, now);
    } else if (at.getTime() > now.getTime() + VIDEO_RETENTION_MS) {
      throw new ValidationError(
        `Ce média est hébergé chez Zernio, qui ne le conserve que ${VIDEO_RETENTION_DAYS} jours : impossible de programmer une publication plus de ${VIDEO_RETENTION_DAYS} jours à l'avance.`,
      );
    }
  }
}
