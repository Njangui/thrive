import { StorageObjectExistsError, type StorageProvider } from "@/domain/ports/storage-provider";
import { isProjectSupabaseHost } from "@/lib/supabase-host";

/**
 * Migration des médias d'un tenant : Supabase Storage -> Cloudflare R2 (C4).
 *
 * Principes (aucun ne doit être assoupli sans en parler) :
 *  - COPIER, jamais déplacer : les fichiers Supabase ne sont JAMAIS supprimés
 *    ici. Retour arrière = réécrire les URL à l'envers (le script fournit la
 *    table ancien -> nouveau) ; les anciennes URL continuent de fonctionner.
 *  - Une URL n'est réécrite en base qu'APRÈS vérification que la copie existe
 *    sur le domaine public R2 avec la même taille.
 *  - Idempotent et reprenable : un fichier déjà copié est reconnu (412), une
 *    ligne déjà réécrite ne correspond plus au filtre ; relancer ne change rien.
 *  - Un tenant à la fois ; seules les URL pointant vers le dossier DE CE
 *    tenant sont traitées (jamais le fichier d'un autre tenant).
 *  - Mode « simulation » par défaut : n'écrit rien.
 *  - Fonctions testables : tout accès externe passe par des ports injectés.
 */

export interface MediaColumnSpec {
  table: string;
  /** Colonne identifiant la ligne (clé de pagination). */
  idColumn: string;
  /** Colonne portant le tenant (filtre obligatoire). */
  orgColumn: string;
  column: string;
}

/**
 * Colonnes du périmètre C4 contenant des URL de médias de tenant.
 * HORS périmètre volontairement (propriétaires : autres équipes / données sensibles) :
 * `social_posts.media_urls`, `telegram_publications.attachment_url`,
 * `contact_broadcasts.image_url` (C5, envois programmés), pièces jointes de
 * messagerie (C2/C3), `expenses.receipt_url` (justificatifs privés), vidéos
 * catalogue (envoyées directement à Zernio, jamais dans `tenant-media`).
 * Leurs anciennes URL Supabase restent valides tant que le bucket est conservé.
 * Pour détecter une colonne oubliée : voir la requête de contrôle dans
 * docs/agents/c4-medias-r2.md.
 */
export const MEDIA_COLUMNS: MediaColumnSpec[] = [
  { table: "organizations", idColumn: "id", orgColumn: "id", column: "logo_url" },
  { table: "organizations", idColumn: "id", orgColumn: "id", column: "banner_url" },
  { table: "organizations", idColumn: "id", orgColumn: "id", column: "favicon_url" },
  { table: "organizations", idColumn: "id", orgColumn: "id", column: "seo_og_image_url" },
  { table: "organization_landing_config", idColumn: "organization_id", orgColumn: "organization_id", column: "hero_media_url" },
  { table: "product_images", idColumn: "id", orgColumn: "organization_id", column: "url" },
  { table: "service_images", idColumn: "id", orgColumn: "organization_id", column: "url" },
  { table: "categories", idColumn: "id", orgColumn: "organization_id", column: "image_url" },
];

/** Marqueur d'URL à migrer, utilisé comme filtre côté base. */
export const SOURCE_URL_MARKER = "/storage/v1/object/public/tenant-media/";

/** Types copiés. Le SVG est volontairement exclu (peut contenir des scripts s'il est ouvert directement depuis le domaine des médias). */
export const MIGRATABLE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/x-icon", "image/vnd.microsoft.icon"] as const;
export const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Chemin d'objet d'une URL publique Supabase du bucket `tenant-media`, si
 * (et seulement si) elle appartient à CE tenant. Garde anti-SSRF / anti-fuite :
 * https uniquement, hôte du projet Supabase, dossier du tenant, pas de `..`.
 */
export function parseTenantMediaUrl(rawUrl: string, organizationId: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isProjectSupabaseHost(url.hostname)) return null;
  if (!url.pathname.startsWith(SOURCE_URL_MARKER)) return null;
  let objectPath: string;
  try {
    objectPath = decodeURIComponent(url.pathname.slice(SOURCE_URL_MARKER.length));
  } catch {
    return null;
  }
  const segments = objectPath.split("/");
  if (segments.some((s) => s === ".." || s === "." || s === "")) return null;
  if (segments[0] !== organizationId) return null;
  return objectPath;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface MediaReferenceRow { rowId: string; value: string | null }

export interface MediaReferenceStore {
  /** Lignes du tenant dont la colonne contient SOURCE_URL_MARKER, triées par identifiant, après `afterId`. */
  findReferences(spec: MediaColumnSpec, organizationId: string, limit: number, afterId: string | null): Promise<MediaReferenceRow[]>;
  /** Compare-and-set : écrit seulement si la valeur actuelle vaut encore `expected`. Retourne true si une ligne a été modifiée. */
  updateValue(spec: MediaColumnSpec, organizationId: string, rowId: string, expected: string, next: string): Promise<boolean>;
}

export type SourceFetch =
  | { ok: true; data: Uint8Array; contentType: string }
  | { ok: false; reason: string };

export interface MediaMigrationDeps {
  store: MediaReferenceStore;
  /** Télécharge un fichier source (URL déjà validée par parseTenantMediaUrl). */
  fetchSource(url: string, maxBytes: number): Promise<SourceFetch>;
  /** Cible : adaptateur R2. */
  target: StorageProvider;
  /** Vérifie la copie sur le domaine PUBLIC cible : existe et taille identique. */
  verifyPublic(url: string): Promise<{ ok: boolean; contentLength: number | null }>;
}

export interface MediaMigrationOptions {
  organizationId: string;
  /** false (défaut) = simulation : aucune lecture de fichier, aucune écriture. */
  apply?: boolean;
  maxFileBytes?: number;
  pageSize?: number;
}

export interface MigrationFailure { table: string; column: string; rowId: string; url: string; reason: string }
export interface MigrationRewrite { table: string; column: string; rowId: string; from: string; to: string }

export interface MediaMigrationReport {
  organizationId: string;
  apply: boolean;
  referencesFound: number;
  /** URL absentes du périmètre (autre hôte, autre tenant, chemin suspect) : ignorées. */
  skippedForeign: number;
  filesCopied: number;
  filesAlreadyPresent: number;
  bytesCopied: number;
  rowsRewritten: number;
  /** Ligne modifiée par quelqu'un d'autre pendant la migration : laissée telle quelle, à relancer. */
  rowsChangedConcurrently: number;
  failures: MigrationFailure[];
  /** Table ancien -> nouveau (pour le retour arrière). Vide en simulation. */
  rewrites: MigrationRewrite[];
}

export async function migrateOrganizationMedia(deps: MediaMigrationDeps, options: MediaMigrationOptions): Promise<MediaMigrationReport> {
  const { organizationId } = options;
  const apply = options.apply === true;
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const pageSize = options.pageSize ?? 200;

  const report: MediaMigrationReport = {
    organizationId, apply, referencesFound: 0, skippedForeign: 0, filesCopied: 0, filesAlreadyPresent: 0,
    bytesCopied: 0, rowsRewritten: 0, rowsChangedConcurrently: 0, failures: [], rewrites: [],
  };

  /** objectPath -> URL cible (ou null si la copie a échoué) : un fichier référencé N fois n'est copié qu'une fois. */
  const copied = new Map<string, string | null>();

  async function ensureCopied(objectPath: string, sourceUrl: string, fail: (reason: string) => void): Promise<string | null> {
    if (copied.has(objectPath)) return copied.get(objectPath) ?? null;
    const remember = (value: string | null) => { copied.set(objectPath, value); return value; };

    const source = await deps.fetchSource(sourceUrl, maxBytes);
    if (!source.ok) { fail(source.reason); return remember(null); }
    if (source.data.byteLength > maxBytes) { fail(`fichier trop volumineux (${source.data.byteLength} octets)`); return remember(null); }
    const contentType = source.contentType.split(";")[0]!.trim().toLowerCase();
    if (!(MIGRATABLE_CONTENT_TYPES as readonly string[]).includes(contentType)) { fail(`type non migré (${contentType || "inconnu"})`); return remember(null); }

    let targetUrl: string;
    let wasPresent = false;
    try {
      targetUrl = (await deps.target.upload({ organizationId, path: objectPath, contentType, data: source.data })).url;
    } catch (error) {
      if (!(error instanceof StorageObjectExistsError)) { fail(error instanceof Error ? error.message : "échec de l'envoi"); return remember(null); }
      wasPresent = true;
      targetUrl = await deps.target.getUrl(organizationId, objectPath);
    }

    // Aucune réécriture sans preuve que la copie est servie, à la bonne taille.
    const check = await deps.verifyPublic(targetUrl);
    if (!check.ok || check.contentLength !== source.data.byteLength) {
      fail(`copie non vérifiée sur le domaine public (taille attendue ${source.data.byteLength}, obtenue ${check.contentLength ?? "?"})`);
      return remember(null);
    }
    if (wasPresent) report.filesAlreadyPresent++;
    else { report.filesCopied++; report.bytesCopied += source.data.byteLength; }
    return remember(targetUrl);
  }

  for (const spec of MEDIA_COLUMNS) {
    let afterId: string | null = null;
    for (;;) {
      const rows = await deps.store.findReferences(spec, organizationId, pageSize, afterId);
      if (rows.length === 0) break;
      afterId = rows[rows.length - 1]!.rowId;

      for (const row of rows) {
        if (!row.value) continue;
        report.referencesFound++;
        const objectPath = parseTenantMediaUrl(row.value, organizationId);
        if (!objectPath) { report.skippedForeign++; continue; }
        if (!apply) continue; // simulation : on compte seulement

        const fail = (reason: string) => report.failures.push({ table: spec.table, column: spec.column, rowId: row.rowId, url: row.value!, reason });
        const targetUrl = await ensureCopied(objectPath, row.value, fail);
        if (!targetUrl) {
          // L'échec a été consigné à la première occurrence ; on consigne aussi les lignes suivantes qui en dépendent.
          if (!report.failures.some((f) => f.rowId === row.rowId && f.column === spec.column)) fail("copie indisponible (voir l'échec du même fichier)");
          continue;
        }
        const updated = await deps.store.updateValue(spec, organizationId, row.rowId, row.value, targetUrl);
        if (updated) {
          report.rowsRewritten++;
          report.rewrites.push({ table: spec.table, column: spec.column, rowId: row.rowId, from: row.value, to: targetUrl });
        } else {
          report.rowsChangedConcurrently++;
        }
      }
      if (rows.length < pageSize) break;
    }
  }
  return report;
}
