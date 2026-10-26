import { StorageObjectExistsError, type StorageProvider, type UploadFileRequest } from "@/domain/ports/storage-provider";
import { signRequestV4 } from "./sigv4";

/**
 * Configuration Cloudflare R2 (API S3-compatible). Voir docs/DEPLOYMENT.md
 * (« Médias sur Cloudflare R2 ») pour la création du bucket, des clés API
 * et du domaine public — tâche humaine, hors code.
 */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Base publique sans slash final (domaine personnalisé du bucket, ex. https://media.exemple.com). */
  publicBaseUrl: string;
}

/** Même règle que SupabaseStorageAdapter : tout chemin est préfixé par l'organisation, de façon idempotente. */
export function toObjectPath(organizationId: string, path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (clean.split("/").some((segment) => segment === ".." || segment === ".")) {
    throw new Error("Chemin de fichier invalide");
  }
  return clean.startsWith(`${organizationId}/`) ? clean : `${organizationId}/${clean}`;
}

export class R2StorageAdapter implements StorageProvider {
  readonly providerName = "r2";

  constructor(
    private readonly config: R2Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private objectUrl(objectPath: string): string {
    const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
    return `https://${this.config.accountId}.r2.cloudflarestorage.com/${this.config.bucket}/${encoded}`;
  }

  private async send(method: string, objectPath: string, extra: { headers?: Record<string, string>; body?: Uint8Array | Buffer } = {}) {
    const url = this.objectUrl(objectPath);
    const headers = signRequestV4(
      { method, url, headers: extra.headers, body: extra.body, region: "auto", service: "s3" },
      { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey },
    );
    return this.fetchImpl(url, {
      method,
      headers,
      body: extra.body ? new Uint8Array(extra.body) : undefined,
    });
  }

  async upload(request: UploadFileRequest): Promise<{ url: string; path: string }> {
    const objectPath = toObjectPath(request.organizationId, request.path);
    const response = await this.send("PUT", objectPath, {
      headers: {
        "content-type": request.contentType,
        // Équivalent de `upsert: false` côté Supabase : ne jamais écraser (à vérifier en conditions réelles : support de If-None-Match sur PutObject R2).
        "if-none-match": "*",
      },
      body: request.data,
    });
    // 412 Precondition Failed = `if-none-match: *` a refusé d'écraser : l'objet existe déjà.
    if (response.status === 412) throw new StorageObjectExistsError(objectPath);
    if (!response.ok) {
      // Jamais le corps de la requête ni les clés dans le message.
      throw new Error(`Échec de l'upload du fichier (${objectPath}): R2 a répondu ${response.status}`);
    }
    return { url: await this.getUrl(request.organizationId, request.path), path: objectPath };
  }

  async delete(organizationId: string, path: string): Promise<void> {
    const objectPath = toObjectPath(organizationId, path);
    const response = await this.send("DELETE", objectPath);
    // 404 toléré : supprimer un objet déjà absent est un succès idempotent.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Échec de la suppression du fichier (${objectPath}): R2 a répondu ${response.status}`);
    }
  }

  async getUrl(organizationId: string, path: string): Promise<string> {
    const objectPath = toObjectPath(organizationId, path);
    const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
    return `${this.config.publicBaseUrl.replace(/\/+$/, "")}/${encoded}`;
  }
}
