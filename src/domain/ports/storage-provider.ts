/**
 * StorageProvider — port métier (section 30).
 * V1 : SupabaseStorageAdapter. Interface prévue pour S3/Cloudinary plus tard.
 */

export interface UploadFileRequest {
  organizationId: string;
  path: string; // ex: 'receipts/2026/08/xyz.png'
  contentType: string;
  data: Uint8Array | Buffer;
}

export interface StorageProvider {
  readonly providerName: string;

  upload(request: UploadFileRequest): Promise<{ url: string; path: string }>;

  delete(organizationId: string, path: string): Promise<void>;

  getUrl(organizationId: string, path: string): Promise<string>;
}
