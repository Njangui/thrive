import { TELEGRAM_UPLOAD_MAX_BYTES, downloadRemoteMedia, isAllowedRemoteMediaHost, isZernioMediaHost } from "@/lib/remote-media";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ZernioSocialClient } from "@/infrastructure/providers/social/zernio/client";
import { isFeatureEnabled } from "./entitlements-service";
import { notifyOrgAdmins } from "./notification-service";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Vidéos du catalogue (produits, services, boutique).
 *
 * DÉCISION EXPLICITE (lot P, revenue en arrière après un premier essai) :
 * les vidéos restent hébergées CHEZ ZERNIO, quelle que soit la contrainte
 * que ça impose. Or Zernio ne fournit AUCUN stockage permanent vérifié —
 * ni dans sa doc, ni dans ses SDK officiels, ni dans son changelog (voir
 * PLAN_LOT_P.md §0.1) : chaque fichier y vit 7 jours, point final.
 *
 * La conservation par offre (7 / 30 / 90 jours) est donc honorée par un
 * RENOUVELLEMENT périodique : avant que la fenêtre de 7 jours de Zernio ne
 * se referme, notre serveur retélécharge le fichier et le retéléverse via
 * un nouveau presign — jusqu'à la date promise par l'offre. Voir
 * `renewExpiringZernioVideos`, appelée par le cron `process-catalog-videos`.
 *
 * RISQUE CONNU, NON VÉRIFIÉ EN CONDITIONS RÉELLES : renouveler charge le
 * fichier ENTIER en mémoire (jusqu'à `MAX_VIDEO_BYTES`) avant de le
 * retéléverser — c'est déjà le mécanisme utilisé pour republier une vidéo
 * sur Telegram/YouTube (lib/remote-media.ts), pas une nouveauté de ce lot,
 * mais renouveler PLUSIEURS grosses vidéos dans un même passage de cron
 * pourrait dépasser la mémoire d'une fonction serverless. Le cron traite
 * un petit lot à la fois (voir `RENEWAL_BATCH_SIZE`) précisément pour ça.
 */

/** Fenêtre réelle de Zernio pour un fichier temporaire (confirmée par la doc) : 7 jours, jamais plus, jamais moins. */
export const VIDEO_RETENTION_DAYS = 7;
export const VIDEO_RETENTION_MS = VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Marge avant l'échéance PROMISE par l'offre : une publication programmée trop près du terme serait risquée. */
export const PUBLICATION_SAFETY_MARGIN_MS = 30 * 60 * 1000;

/**
 * Marge de renouvellement : à combien de temps de la fermeture réelle de la
 * fenêtre Zernio (7 jours) le cron doit-il déjà avoir renouvelé le fichier ?
 * Large (36 h) pour absorber plusieurs échecs consécutifs sans jamais
 * laisser une vidéo encore "promise" par l'offre devenir inaccessible.
 */
export const RENEWAL_MARGIN_MS = 36 * 60 * 60 * 1000;
/** Nombre de vidéos renouvelées par passage de cron — borne la mémoire utilisée (voir note de risque ci-dessus). */
export const RENEWAL_BATCH_SIZE = 5;

/** MP4 et MOV : les deux formats acceptés par TOUS les canaux visés (YouTube, TikTok, Instagram, Facebook, Telegram). */
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;
/** 200 Mo : au-delà, Zernio « peut ne pas » compresser la vidéo aux limites de chaque plateforme (doc « Media Uploads »). */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** Telegram (Bot API) : notre serveur relit la vidéo puis la TÉLÉVERSE — plafond 50 Mo. */
export { TELEGRAM_UPLOAD_MAX_BYTES };

export interface CatalogVideo {
  id: string;
  productId: string | null;
  serviceId: string | null;
  title: string | null;
  url: string;
  contentType: string;
  sizeBytes: number | null;
  uploadedAt: string;
  /** Échéance PROMISE par l'offre (7/30/90 jours) — fixée à l'envoi, jamais reculée. */
  expiresAt: string;
  /** Fin de la fenêtre Zernio ACTUELLE (7 jours, renouvelée avant terme par le cron). */
  hostExpiresAt: string;
  /** Dernier échec de renouvellement, s'il y en a un (diagnostic, pas forcément bloquant). */
  renewalError: string | null;
  expired: boolean;
}

// ---------------------------------------------------------------------------
// Fonctions pures (testées en isolation)
// ---------------------------------------------------------------------------

export function computeCatalogVideoExpiry(uploadedAt: Date, retentionDays: number): Date {
  return new Date(uploadedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

/** Fin de la fenêtre Zernio (7 jours fixes, quelle que soit l'offre — c'est la contrainte réelle du fournisseur). */
export function computeHostExpiry(from: Date): Date {
  return new Date(from.getTime() + VIDEO_RETENTION_MS);
}

/** Compatibilité : ancien nom, mêmes 7 jours. */
export function computeVideoExpiry(uploadedAt: Date): Date {
  return computeHostExpiry(uploadedAt);
}

export function isVideoExpired(expiresAt: string | Date, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
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
  return date.toLocaleString("fr-FR", { timeZone: "Africa/Douala", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Une vidéo est-elle prête pour une publication programmée à `publishAt` ?
 * Vérifie DEUX échéances : la promesse de l'offre (`expiresAt`) ET, si elle
 * est connue, la fenêtre Zernio réelle (`hostExpiresAt`) — si le
 * renouvellement a échoué et que la fenêtre Zernio est déjà close, le
 * fichier est concrètement introuvable chez Zernio, quelle que soit la
 * promesse de l'offre.
 */
export function assertVideoAvailableForPublication(
  video: { title: string | null; expiresAt: Date; hostExpiresAt?: Date; retentionDays?: number },
  publishAt: Date,
  now: Date = new Date(),
): void {
  const label = video.title ? `« ${video.title} »` : "sélectionnée";

  if (video.hostExpiresAt && video.hostExpiresAt.getTime() <= now.getTime()) {
    throw new ValidationError(`La vidéo ${label} n'est plus disponible chez Zernio (le renouvellement automatique a dû échouer). Téléversez-la à nouveau.`);
  }
  if (video.expiresAt.getTime() <= now.getTime()) {
    throw new ValidationError(`La vidéo ${label} a expiré : cette vidéo n'est conservée que ${video.retentionDays ?? VIDEO_RETENTION_DAYS} jours. Téléversez-la à nouveau.`);
  }
  const effectiveDeadline = video.hostExpiresAt && video.hostExpiresAt.getTime() < video.expiresAt.getTime() ? video.hostExpiresAt : video.expiresAt;
  if (publishAt.getTime() > effectiveDeadline.getTime() - PUBLICATION_SAFETY_MARGIN_MS) {
    throw new ValidationError(
      `La vidéo ${label} n'est disponible que jusqu'au ${formatDeadline(effectiveDeadline)}. ` +
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
  storage_key: string | null;
  content_type: string;
  size_bytes: number | null;
  uploaded_at: string;
  expires_at: string;
  host_expires_at: string;
  renewal_error: string | null;
}

const VIDEO_COLUMNS =
  "id, product_id, service_id, title, url, storage_key, content_type, size_bytes, uploaded_at, expires_at, host_expires_at, renewal_error";

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
    hostExpiresAt: row.host_expires_at,
    renewalError: row.renewal_error,
    expired: isVideoExpired(row.expires_at, now) || isVideoExpired(row.host_expires_at, now),
  };
}

export interface VideoUploadTicket {
  /** URL d'envoi Zernio (présignée, 1 h) : le navigateur y fait un `PUT` direct, sans passer par notre serveur. */
  uploadUrl: string;
  publicUrl: string;
  storageKey: string | null;
  contentType: string;
}

/**
 * Étape 1 : vérifie le format et la taille, puis émet un presign Zernio.
 * Clé API PLATEFORME (pas de connexion par organisation — un seul compte
 * Zernio sert tous les tenants, comme pour les publications sociales).
 */
export async function requestVideoUploadTicket(_organizationId: string, fileName: string, contentType: string, sizeBytes: number): Promise<VideoUploadTicket> {
  validateVideoFile(contentType, sizeBytes);
  const presign = await new ZernioSocialClient().createMediaPresign(fileName, contentType, sizeBytes);
  return { uploadUrl: presign.uploadUrl, publicUrl: presign.publicUrl, storageKey: presign.key ?? null, contentType };
}

export interface RegisterCatalogVideoInput {
  publicUrl: string;
  storageKey?: string | null;
  contentType: string;
  /** Taille annoncée par le navigateur après l'envoi — Zernio n'offre aucun moyen de la revérifier après coup (pas d'API de listing). */
  sizeBytes: number;
  title?: string | null;
  productId?: string | null;
  serviceId?: string | null;
}

/** Message d'erreur si une vidéo du catalogue dépasse ce que Telegram accepte par téléversement (50 Mo), sinon `null`. Fonction pure. */
export function telegramVideoLimitMessage(sizeBytes: number | null | undefined): string | null {
  if (!sizeBytes || sizeBytes <= TELEGRAM_UPLOAD_MAX_BYTES) return null;
  return `Telegram n'accepte pas les vidéos de plus de ${TELEGRAM_UPLOAD_MAX_BYTES / 1024 / 1024} Mo (cette vidéo pèse ${Math.round(sizeBytes / 1024 / 1024)} Mo). Publiez-la sur les autres réseaux, ou utilisez une version allégée pour Telegram.`;
}

/** Vérifie la taille d'une vidéo du catalogue (par URL) avant un envoi Telegram. Ne lève pas si l'URL est inconnue. */
export async function telegramVideoLimitErrorForUrl(organizationId: string, url: string): Promise<string | null> {
  const { data } = await getSupabaseServiceClient().from("catalog_videos").select("size_bytes").eq("organization_id", organizationId).eq("url", url).maybeSingle();
  return telegramVideoLimitMessage(data?.size_bytes as number | null | undefined);
}

/** Étape 2 : enregistre la vidéo une fois l'envoi terminé (Zernio n'offrant pas de vérification a posteriori, la taille annoncée par le navigateur est celle qu'on garde). */
export async function registerCatalogVideo(organizationId: string, input: RegisterCatalogVideoInput): Promise<CatalogVideo> {
  validateVideoFile(input.contentType, input.sizeBytes);
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

  const { limit: planDays } = await isFeatureEnabled(organizationId, "video_retention_days");
  const retentionDays = planDays > 0 ? planDays : VIDEO_RETENTION_DAYS;
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
      size_bytes: input.sizeBytes,
      uploaded_at: uploadedAt.toISOString(),
      expires_at: computeCatalogVideoExpiry(uploadedAt, retentionDays).toISOString(),
      host_expires_at: computeHostExpiry(uploadedAt).toISOString(),
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

/** Retire la référence. Rien à supprimer chez Zernio : aucune API de suppression confirmée, et le fichier s'y efface tout seul faute de renouvellement. */
export async function deleteCatalogVideo(organizationId: string, videoId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("catalog_videos").delete().eq("organization_id", organizationId).eq("id", videoId).select("id").maybeSingle();
  if (error) throw new Error(`Suppression de la vidéo impossible: ${error.message}`);
  if (!data) throw new NotFoundError("Vidéo introuvable");
}

/** Vidéos AFFICHABLES sur la vitrine publique. Ne lève jamais : une panne ici ne doit pas casser une page publique. */
export async function listActiveStorefrontVideos(organizationId: string, options: { productId?: string; serviceId?: string; limit?: number } = {}): Promise<CatalogVideo[]> {
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
 * contenant des vidéos hébergées chez Zernio (jamais pour une image ou une
 * URL externe ordinaire).
 *  - vidéo connue du catalogue : comparée à SON échéance d'offre ET à sa
 *    fenêtre Zernio réelle (les deux, voir assertVideoAvailableForPublication) ;
 *  - URL Zernio inconnue de la table (saisie à la main, rarissime) : au
 *    plus 7 jours à partir de MAINTENANT, faute de connaître sa date
 *    d'envoi réelle — jamais renouvelée (on ne sait pas qu'elle existe).
 */
export async function assertPublicationMediaAvailable(organizationId: string, mediaUrls: string[], publishAt: Date | null): Promise<void> {
  const hostedUrls = [...new Set(mediaUrls.filter(isAllowedRemoteMediaHost))];
  if (hostedUrls.length === 0) return;

  const { data, error } = await getSupabaseServiceClient()
    .from("catalog_videos")
    .select("title, url, expires_at, host_expires_at")
    .eq("organization_id", organizationId)
    .in("url", hostedUrls);
  if (error) throw new Error(`Erreur lecture vidéos: ${error.message}`);

  const known = new Map<string, { title: string | null; expires_at: string; host_expires_at: string }>();
  for (const row of data ?? []) known.set(row.url as string, { title: row.title as string | null, expires_at: row.expires_at as string, host_expires_at: row.host_expires_at as string });
  const now = new Date();
  const at = publishAt ?? now;

  for (const url of hostedUrls) {
    const video = known.get(url);
    if (video) {
      assertVideoAvailableForPublication({ title: video.title, expiresAt: new Date(video.expires_at), hostExpiresAt: new Date(video.host_expires_at) }, at, now);
      continue;
    }
    if (isZernioMediaHost(url)) {
      if (at.getTime() > now.getTime() + VIDEO_RETENTION_MS) {
        throw new ValidationError(`Ce média est hébergé chez Zernio (7 jours maximum, non renouvelé automatiquement car hors de notre catalogue) : impossible de programmer une publication aussi tardive.`);
      }
      continue;
    }
    throw new ValidationError("Vidéo introuvable dans votre catalogue. Sélectionnez-la à nouveau.");
  }
}

// ---------------------------------------------------------------------------
// Cron : renouvellement avant l'expiration Zernio + notification anticipée
// ---------------------------------------------------------------------------

export interface RenewExpiringVideosResult {
  renewed: number;
  failed: number;
  expired: number;
}

/**
 * Retéléverse chez Zernio, AVANT que sa fenêtre de 7 jours ne se referme,
 * chaque vidéo encore couverte par la promesse de l'offre (`expires_at`
 * dans le futur). Un échec est enregistré (`renewal_error`) et retenté au
 * prochain passage — sans jamais avancer `expires_at` : la promesse de
 * l'offre ne change pas, seule la fenêtre Zernio (`host_expires_at`) est
 * repoussée à chaque succès.
 */
export async function renewExpiringZernioVideos(now: Date = new Date(), batchSize = RENEWAL_BATCH_SIZE): Promise<RenewExpiringVideosResult> {
  const supabase = getSupabaseServiceClient();
  const { data: rows, error } = await supabase
    .from("catalog_videos")
    .select("id, organization_id, url, content_type, title, expires_at, host_expires_at")
    .gt("expires_at", now.toISOString())
    .lte("host_expires_at", new Date(now.getTime() + RENEWAL_MARGIN_MS).toISOString())
    .order("host_expires_at", { ascending: true })
    .limit(batchSize);
  if (error) throw new Error(`Lecture des vidéos à renouveler impossible: ${error.message}`);

  const result: RenewExpiringVideosResult = { renewed: 0, failed: 0, expired: 0 };
  const client = new ZernioSocialClient();

  for (const row of rows ?? []) {
    try {
      // Fichier ENTIER en mémoire (jusqu'à MAX_VIDEO_BYTES) — voir la note de risque en tête de fichier.
      const { data: bytes } = await downloadRemoteMedia(row.url as string, MAX_VIDEO_BYTES);
      const fileName = (row.title as string | null)?.trim() || "video.mp4";
      const presign = await client.createMediaPresign(fileName, row.content_type as string, bytes.byteLength);

      const putRes = await fetch(presign.uploadUrl, { method: "PUT", headers: { "Content-Type": row.content_type as string }, body: bytes as unknown as BodyInit }); // Uint8Array accepté à l'exécution par fetch ; le cast évite une copie de 200 Mo (typage ArrayBufferLike trop strict en TS ≥ 6)
      if (!putRes.ok) throw new Error(`Envoi Zernio refusé (${putRes.status}).`);

      const { error: updateError } = await supabase
        .from("catalog_videos")
        .update({ url: presign.publicUrl, storage_key: presign.key ?? null, host_expires_at: computeHostExpiry(now).toISOString(), renewal_error: null })
        .eq("id", row.id);
      if (updateError) throw new Error(updateError.message);
      result.renewed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`renewExpiringZernioVideos(${row.id}) échec:`, message);
      await supabase.from("catalog_videos").update({ renewal_error: message.slice(0, 500) }).eq("id", row.id);
      if (isVideoExpired(row.host_expires_at as string, now)) result.expired++;
      else result.failed++;
    }
  }
  return result;
}

/** Fenêtre quotidienne large (60–84 h) pour ne rater aucune vidéo malgré un cron une fois par jour. */
const EXPIRY_NOTICE_MIN_MS = 60 * 60 * 60 * 1000;
const EXPIRY_NOTICE_MAX_MS = 84 * 60 * 60 * 1000;

export interface NotifyExpiringVideosResult {
  notified: number;
}

/** Prévient le commerçant ~3 jours avant l'échéance PROMISE par l'offre (pas la fenêtre Zernio, invisible pour lui — voir renewExpiringZernioVideos). */
export async function notifyExpiringCatalogVideos(now: Date = new Date(), batchSize = 100): Promise<NotifyExpiringVideosResult> {
  const supabase = getSupabaseServiceClient();
  const { data: rows, error } = await supabase
    .from("catalog_videos")
    .select("id, organization_id, title, expires_at")
    .eq("notified_expiry_soon", false)
    .gte("expires_at", new Date(now.getTime() + EXPIRY_NOTICE_MIN_MS).toISOString())
    .lte("expires_at", new Date(now.getTime() + EXPIRY_NOTICE_MAX_MS).toISOString())
    .limit(batchSize);
  if (error) throw new Error(`Lecture des vidéos bientôt expirées impossible: ${error.message}`);

  let notified = 0;
  for (const row of rows ?? []) {
    await notifyOrgAdmins({
      organizationId: row.organization_id as string,
      title: "Une vidéo va bientôt expirer.",
      body: `${row.title ? `« ${row.title} »` : "Votre vidéo"} sera retirée le ${formatDeadline(new Date(row.expires_at as string))}. Téléversez-la à nouveau pour la conserver.`,
      relatedEntityType: "catalog_video",
      relatedEntityId: row.id as string,
      priority: "normal",
    }).catch((err) => console.warn(`notifyExpiringCatalogVideos(${row.id}): notification impossible:`, err));
    const { error: updateError } = await supabase.from("catalog_videos").update({ notified_expiry_soon: true }).eq("id", row.id);
    if (updateError) console.error(`notifyExpiringCatalogVideos(${row.id}): marquage notifié impossible:`, updateError.message);
    else notified++;
  }
  return { notified };
}
