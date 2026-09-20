import { randomUUID } from "node:crypto";
import { getStorageProvider } from "@/infrastructure/providers/registry";
import { ValidationError } from "@/lib/errors";

/**
 * Types de médias gérés par le Lot E (section 29/52-56/76-77 du master
 * prompt) + Lot H (`seo_og`, section 18 — image Open Graph par défaut de
 * l'organisation, 0022_seo_fields.sql). Sert de sous-dossier dans le
 * bucket — voir buildTenantObjectPath.
 *
 * "hero" (vitrine V2) : visuel de l'en-tête de la page d'accueil, distinct
 * de "banner". La bannière est une image large (ratio 3/1) héritée du
 * Lot E, alors que la composition « texte + visuel » attend un format
 * portrait/carré ; les ranger sous le même type rendrait impossible de
 * remplacer l'un sans écraser l'autre.
 *
 * "service" (catalogue V2, 0056) : galerie photo d'une prestation —
 * distinct de "product" pour la même raison que le reste de ce fichier
 * distingue produits et services (dossiers de stockage séparés, jamais
 * mélangés dans le même sous-répertoire du bucket).
 *
 * "telegram-inbox" : pièces jointes reçues par le bot Telegram d'un tenant
 * (webhook /api/webhooks/telegram/tenant/[token]) — Telegram Omnichannel v3.
 *
 * "message-attachment" : pièces jointes et messages vocaux ENVOYÉS depuis la
 * messagerie du dashboard (message-attachment-service.ts).
 */
export type MediaType =
  | "logo"
  | "banner"
  | "favicon"
  | "product"
  | "seo_og"
  | "hero"
  | "service"
  | "telegram-inbox"
  | "message-attachment";

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

export interface ResolveImagesOptions {
  organizationId: string;
  mediaType: MediaType;
  /** Nom du champ `<input type="file" multiple>` dans le FormData. */
  filesField: string;
  /** Nom du champ texte (plusieurs URLs, une par ligne) dans le FormData. */
  urlsField: string;
}

/**
 * CORRECTIF (retour commerçant, sept. 2026) : ajouter une galerie de
 * plusieurs photos demandait un enregistrement par photo
 * (`resolveImageFromFormData` ne traite qu'un seul champ fichier + un
 * seul champ URL). Version plurielle : un seul appel traite PLUSIEURS
 * fichiers ET plusieurs URLs collées (une par ligne) en une seule
 * soumission — combinées, pas exclusives, puisqu'un commerçant peut
 * vouloir ajouter deux photos de son téléphone ET une URL trouvée
 * ailleurs d'un même geste.
 *
 * Contrairement à l'import CSV (traitement autonome de dizaines de
 * lignes, où une entrée cassée ne doit jamais faire perdre les autres),
 * ce chemin est un formulaire interactif rempli en direct par un humain
 * : un fichier trop lourd ou du mauvais type fait échouer TOUTE la
 * soumission avec un message clair, plutôt que de l'ignorer
 * silencieusement et laisser le commerçant se demander pourquoi une
 * photo manque. Les URLs collées, elles, ne sont pas validées ici — même
 * choix que `resolveImageFromFormData` pour l'URL unique.
 */
export async function resolveImagesFromFormData(formData: FormData, opts: ResolveImagesOptions): Promise<string[]> {
  const urls: string[] = [];

  for (const entry of formData.getAll(opts.filesField)) {
    if (!(entry instanceof File) || entry.size === 0) continue;

    if (entry.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError(`"${entry.name}" dépasse 5 Mo — retirez-la ou compressez-la avant de réessayer.`);
    }
    if (!entry.type.startsWith("image/")) {
      throw new ValidationError(`"${entry.name}" n'est pas une image.`);
    }

    const provider = await getStorageProvider(opts.organizationId);
    const buffer = Buffer.from(await entry.arrayBuffer());
    const path = buildTenantObjectPath(opts.mediaType, entry.name);
    const { url } = await provider.upload({
      organizationId: opts.organizationId,
      path,
      contentType: entry.type,
      data: buffer,
    });
    urls.push(url);
  }

  const pastedUrls = String(formData.get(opts.urlsField) ?? "")
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);
  urls.push(...pastedUrls);

  return urls;
}
