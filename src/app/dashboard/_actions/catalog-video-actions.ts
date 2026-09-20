"use server";

import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import {
  deleteCatalogVideo,
  registerCatalogVideo,
  requestVideoUploadTicket,
  type CatalogVideo,
  type RegisterCatalogVideoInput,
  type VideoUploadTicket,
} from "@/application/services/catalog-video-service";
import { AppError } from "@/lib/errors";

/**
 * Server Actions du panneau « Vidéos » (fiche produit / service).
 *
 * Le fichier vidéo ne passe JAMAIS par ces actions : Vercel refuse tout
 * corps de requête > 4,5 Mo. L'action 1 renvoie une URL présignée Zernio, le
 * navigateur y envoie le fichier directement, l'action 2 enregistre le
 * résultat (voir catalog-videos-panel.tsx).
 *
 * Résultats renvoyés plutôt que levés : une exception serveur arrive
 * côté client avec un message masqué en production.
 */

export type VideoActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function authorize(): Promise<string> {
  const { organizationId } = await requireCurrentOrganization();
  await requireMembership(organizationId, ["owner", "admin", "manager"]);
  return organizationId;
}

function toFailure(error: unknown): { ok: false; error: string } {
  if (error instanceof AppError) return { ok: false, error: error.message };
  console.error("[catalog-videos] action échouée:", error);
  const detail = error instanceof Error && /ZERNIO_API_KEY/.test(error.message) ? " (clé Zernio non configurée)" : "";
  return { ok: false, error: `Opération impossible pour le moment${detail}. Réessayez dans un instant.` };
}

export async function requestVideoUploadAction(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<VideoActionResult<VideoUploadTicket>> {
  try {
    await authorize();
    return { ok: true, data: await requestVideoUploadTicket(input.fileName, input.contentType, input.sizeBytes) };
  } catch (error) {
    return toFailure(error);
  }
}

export async function registerVideoAction(input: RegisterCatalogVideoInput): Promise<VideoActionResult<CatalogVideo>> {
  try {
    const organizationId = await authorize();
    return { ok: true, data: await registerCatalogVideo(organizationId, input) };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteVideoAction(videoId: string): Promise<VideoActionResult<null>> {
  try {
    const organizationId = await authorize();
    await deleteCatalogVideo(organizationId, videoId);
    return { ok: true, data: null };
  } catch (error) {
    return toFailure(error);
  }
}
