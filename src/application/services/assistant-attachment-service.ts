import { getStorageProvider } from "@/infrastructure/providers/registry";
import { ValidationError } from "@/lib/errors";
import type { AgentActor } from "@/application/channels/actor";
import type { AgentAttachment } from "@/domain/ports/agent-runtime-port";
import { buildTenantObjectPath } from "./media-service";

/**
 * Pièces jointes du chat propriétaire (photos de reçus, vocaux, PDF).
 *
 * Liste blanche stricte + vérification de la SIGNATURE binaire (le Content-Type
 * déclaré par le navigateur ne suffit pas). Pas de SVG/HTML/vidéo.
 * LIMITE CONNUE : le stockage actuel est le bucket public du tenant ; le chemin
 * contient un UUID non devinable mais l'URL n'est pas authentifiée. À migrer
 * vers un stockage privé avec URL signées (adaptateur R2 de C4) — voir
 * docs/agents/c2-chat-dashboard.md.
 */
export const MAX_ASSISTANT_ATTACHMENT_BYTES = 4 * 1024 * 1024;

type Kind = AgentAttachment["kind"];
const ALLOWED: Record<string, Kind> = {
  "image/jpeg": "image", "image/png": "image", "image/webp": "image",
  "audio/ogg": "audio", "audio/mp4": "audio", "audio/mpeg": "audio", "audio/webm": "audio",
  "application/pdf": "document",
};

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
/** Signature binaire cohérente avec le type MIME annoncé. */
export function matchesSignature(mime: string, b: Uint8Array): boolean {
  switch (mime) {
    case "image/jpeg": return startsWith(b, [0xff, 0xd8, 0xff]);
    case "image/png": return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp": return startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8);
    case "audio/ogg": return startsWith(b, [0x4f, 0x67, 0x67, 0x53]);
    case "audio/webm": return startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]);
    case "audio/mp4": return startsWith(b, [0x66, 0x74, 0x79, 0x70], 4);
    case "audio/mpeg": return startsWith(b, [0x49, 0x44, 0x33]) || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0);
    case "application/pdf": return startsWith(b, [0x25, 0x50, 0x44, 0x46]);
    default: return false;
  }
}

export function normalizeMime(raw: string): string {
  return raw.split(";")[0]!.trim().toLowerCase();
}

export function validateAssistantFile(file: { type: string; size: number; name: string }, bytes: Uint8Array): { mime: string; kind: Kind } {
  const mime = normalizeMime(file.type);
  const kind = ALLOWED[mime];
  if (!kind) throw new ValidationError("Type de fichier non pris en charge (photo, vocal ou PDF).");
  if (file.size <= 0 || bytes.byteLength !== file.size) throw new ValidationError("Fichier invalide.");
  if (file.size > MAX_ASSISTANT_ATTACHMENT_BYTES) throw new ValidationError("Fichier trop volumineux (4 Mo maximum).");
  if (!matchesSignature(mime, bytes)) throw new ValidationError("Le contenu du fichier ne correspond pas à son type.");
  return { mime, kind };
}

export async function uploadAssistantAttachment(actor: AgentActor, file: File): Promise<AgentAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { mime, kind } = validateAssistantFile(file, bytes);
  const path = buildTenantObjectPath("assistant-attachment", file.name || "fichier");
  const storage = await getStorageProvider(actor.tenantId);
  const uploaded = await storage.upload({ organizationId: actor.tenantId, path, contentType: mime, data: bytes });
  return { kind, path: uploaded.path, name: (file.name || "fichier").slice(0, 120), mimeType: mime, size: file.size };
}

/**
 * Un chemin de pièce jointe reçu du client doit désigner EXACTEMENT un fichier
 * du chat de CE tenant : `{tenantId}/assistant-attachment/{uuid}-{nom sûr}`
 * (forme renvoyée par l'adaptateur de stockage). Tout autre préfixe — autre
 * tenant, autre dossier, `..`, chemin sans préfixe — est refusé : sinon un
 * membre pourrait faire lire au runtime un fichier d'un autre tenant.
 */
export function isOwnAttachmentPath(tenantId: string, path: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return false;
  const prefix = `${tenantId}/assistant-attachment/`;
  if (!path.startsWith(prefix)) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,100}$/i.test(path.slice(prefix.length)) && !path.includes("..");
}
