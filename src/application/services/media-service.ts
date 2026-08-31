import { randomUUID } from "node:crypto";
import { getStorageProvider } from "@/infrastructure/providers/registry";
import { ValidationError } from "@/lib/errors";

/**
 * Types de médias gérés par le Lot E (section 29/52-56/76-77 du master
 * prompt). Sert de sous-dossier dans le bucket — voir buildTenantObjectPath.
 */
export type MediaType = "logo" | "banner" | "favicon" | "product";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 Mo — large mais borné (section 54 : échouer fort plutôt que silencieusement)

/**
 * Politique de nommage (cahier Lot E, Partie 1) :
 * `{organization_id}/{type}/{uuid}-{filename}`. L'organizationId N'EST PAS
 * inclus ici — c'est `StorageProvider.upload`/`getUrl`/`delete` qui le
 * préfixe (voir storage-provider.ts : `path` est déjà relatif à l'org,
 * comme le montre l'exemple `'receipts/2026/08/xyz.png'` dans le port).
 * Fonction PURE, testée en isolation (media-service.test.ts).
 */
export function buildTenantObjectPath(type: MediaType, filename: string): string {
  const uuid = randomUUID();
  // FUSION — correctif : chaque caractère non sûr est remplacé par un `_`
  // individuel, donc un nom composé uniquement de symboles (ex: "★★★")
  // devient "___" — une chaîne non vide, donc `|| "fichier"` ne se
  // déclenchait jamais (bug détecté par le test Lot E lui-même, code
  // original inchangé sinon). On vérifie qu'il reste au moins un
  // caractère alphanumérique réel plutôt que de tester la vacuité.
  const cleaned = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const safeFilename = /[a-zA-Z0-9]/.test(cleaned) ? cleaned : "fichier";
  return `${type}/${uuid}-${safeFilename}`;
}

export interface ResolveImageOptions {
  organizationId: string;
  mediaType: MediaType;
  /** Nom du champ `<input type="file">` dans le FormData. */
  fileField: string;
  /** Nom du champ texte (URL collée) dans le FormData. */
  urlField: string;
  /** Valeur actuelle (pour ne rien changer si les deux champs sont vides). */
  currentUrl?: string | null;
}

/**
 * Résout l'image finale à partir d'un FormData de formulaire mixte
 * (upload réel OU URL collée, cahier Lot E Partie 1 : "gardez la
 * possibilité de coller une URL directe en option"). Priorité au fichier
 * uploadé s'il est présent ; sinon utilise l'URL texte si non vide ; sinon
 * conserve `currentUrl` (aucun changement, ex : l'utilisateur ne touche pas
 * ce champ en édition).
 *
 * Ne fait AUCUNE hypothèse sur le provider concret — passe toujours par
 * `getStorageProvider()` (section "Architecture" de 00_CONVENTIONS_COMMUNES).
 */
export async function resolveImageFromFormData(
  formData: FormData,
  opts: ResolveImageOptions,
): Promise<string | null> {
  const fileEntry = formData.get(opts.fileField);

  if (fileEntry instanceof File && fileEntry.size > 0) {
    if (fileEntry.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError("Le fichier est trop volumineux (5 Mo maximum).");
    }
    if (!fileEntry.type.startsWith("image/")) {
      throw new ValidationError("Seules les images sont acceptées pour ce champ.");
    }

    const provider = await getStorageProvider(opts.organizationId);
    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    const path = buildTenantObjectPath(opts.mediaType, fileEntry.name);

    const { url } = await provider.upload({
      organizationId: opts.organizationId,
      path,
      contentType: fileEntry.type,
      data: buffer,
    });

    return url;
  }

  const typedUrl = String(formData.get(opts.urlField) ?? "").trim();
  if (typedUrl) return typedUrl;

  return opts.currentUrl ?? null;
}
