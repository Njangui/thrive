import { getStorageProvider } from "@/infrastructure/providers/registry";
import { ValidationError } from "@/lib/errors";
import { buildTenantObjectPath } from "./media-service";

/**
 * Pièces jointes et messages vocaux ENVOYÉS depuis la messagerie du
 * dashboard (bouton 📎 et micro du champ de réponse).
 *
 * Le transport existait déjà (ZernioAdapter : `attachmentUrl` +
 * `attachmentType` ; Telegram : sendPhoto/sendVideo/sendAudio/sendDocument)
 * mais aucun écran ne permettait de joindre quoi que ce soit — le champ de
 * réponse n'acceptait que du texte. Ce service valide le fichier, le
 * range dans le bucket public du tenant (le provider a besoin d'une URL
 * publique) et renvoie ce qu'il faut pour `sendHumanReply`.
 */

/**
 * 4 Mo : les fonctions Vercel refusent tout corps de requête > 4,5 Mo (le
 * fichier transite par une Server Action). Ce plafond est aussi sous les
 * 5 Mo du bucket `tenant-media` (migration 0013) et sous les limites des
 * canaux (WhatsApp/Zernio : 25 Mo, Telegram : 50 Mo).
 */
export const MAX_MESSAGE_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export type OutboundAttachmentType = "image" | "video" | "audio" | "file";

export interface ClassifiedAttachment {
  type: OutboundAttachmentType;
  /** Type MIME sans paramètres (`audio/ogg;codecs=opus` → `audio/ogg`). */
  mimeType: string;
  /** Vrai seulement pour un audio explicitement enregistré comme vocal ET dans un format que le canal sait rendre comme tel. */
  isVoiceNote: boolean;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/3gpp"]);
// audio/webm est volontairement absent : voir le traitement plus bas.
const AUDIO_TYPES = new Set(["audio/ogg", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/amr"]);
const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

/** Formats qu'un vocal Telegram (`sendVoice`) accepte : OGG/OPUS, MP3, M4A. */
const TELEGRAM_VOICE_TYPES = new Set(["audio/ogg", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a"]);

export function normalizeMimeType(mimeType: string): string {
  return (mimeType.split(";")[0] ?? "").trim().toLowerCase();
}

/**
 * Décide du type d'envoi d'un fichier pour un canal donné, ou refuse avec
 * un message clair. Fonction PURE (testée en isolation).
 *
 * Point délicat — le vocal enregistré par le navigateur : Chrome/Edge
 * produisent du WebM (Opus) quand ils ne savent rien de mieux, un format
 * que ni WhatsApp ni Telegram n'acceptent comme audio. Le client préfère
 * donc OGG/OPUS ou MP4/AAC quand le navigateur sait les enregistrer (voir
 * conversation-composer.tsx). Si on reçoit quand même du WebM :
 *  - WhatsApp : refus explicite (le message serait accepté par l'API puis
 *    jamais délivré — pire qu'une erreur immédiate) ;
 *  - Telegram : envoyé en fichier joint, lisible par le client.
 */
export function classifyAttachment(mimeTypeRaw: string, channel: string, wantsVoiceNote: boolean): ClassifiedAttachment {
  const mimeType = normalizeMimeType(mimeTypeRaw);
  const isWhatsapp = channel === "whatsapp";

  if (IMAGE_TYPES.has(mimeType)) {
    if (isWhatsapp && mimeType === "image/webp") {
      throw new ValidationError("WhatsApp n'accepte que les images JPG ou PNG. Convertissez l'image puis réessayez.");
    }
    return { type: "image", mimeType, isVoiceNote: false };
  }

  if (VIDEO_TYPES.has(mimeType)) return { type: "video", mimeType, isVoiceNote: false };

  if (mimeType === "audio/webm") {
    if (isWhatsapp) {
      throw new ValidationError(
        "Votre navigateur enregistre les vocaux dans un format que WhatsApp n'accepte pas (WebM). Utilisez Safari ou Firefox, ou joignez un fichier .mp3 / .m4a.",
      );
    }
    return { type: "file", mimeType, isVoiceNote: false };
  }

  if (AUDIO_TYPES.has(mimeType)) {
    const voice = wantsVoiceNote && (isWhatsapp || TELEGRAM_VOICE_TYPES.has(mimeType));
    return { type: "audio", mimeType, isVoiceNote: voice };
  }

  if (DOCUMENT_TYPES.has(mimeType)) return { type: "file", mimeType, isVoiceNote: false };

  throw new ValidationError(
    "Type de fichier non pris en charge. Formats acceptés : images (JPG, PNG), vidéo MP4, audio (MP3, M4A, OGG), PDF, Word, Excel, PowerPoint, TXT, CSV.",
  );
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

export interface UploadedOutboundAttachment extends ClassifiedAttachment {
  url: string;
  fileName: string;
}

/**
 * Valide puis stocke le fichier. `channel` sert à choisir les formats
 * acceptés (voir `classifyAttachment`) — un refus lève une `ValidationError`
 * AVANT tout upload.
 */
export async function uploadOutboundAttachment(
  organizationId: string,
  file: File,
  channel: string,
  wantsVoiceNote: boolean,
): Promise<UploadedOutboundAttachment> {
  if (file.size === 0) throw new ValidationError("Le fichier est vide.");
  if (file.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
    throw new ValidationError(
      `Fichier trop lourd (${(file.size / 1024 / 1024).toFixed(1)} Mo) — 4 Mo maximum par pièce jointe.`,
    );
  }

  const classified = classifyAttachment(file.type, channel, wantsVoiceNote);

  const extension = EXTENSION_BY_MIME[classified.mimeType];
  const fallbackName = `${classified.isVoiceNote ? "vocal" : "piece-jointe"}${extension ? `.${extension}` : ""}`;
  const fileName = file.name?.trim() || fallbackName;

  const storage = await getStorageProvider(organizationId);
  const path = buildTenantObjectPath("message-attachment", fileName);
  const uploaded = await storage.upload({
    organizationId,
    path,
    contentType: classified.mimeType,
    data: new Uint8Array(await file.arrayBuffer()),
  });

  return { ...classified, url: uploaded.url, fileName };
}
