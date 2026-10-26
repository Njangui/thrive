/**
 * SpeechPort — frontière C2 ↔ C3 pour la transcription des vocaux.
 *
 * ALIGNEMENT C3 : forme provisoire. C3 livre l'adaptateur réel (Voxtral, « à vérifier » côté
 * API) et l'enregistre via `registerSpeechPort()` ; jusqu'à là, l'adaptateur par défaut refuse
 * proprement (`SpeechUnavailableError`) — C2 ne devine aucune API de transcription.
 * La synthèse vocale (réponses parlées) est hors du périmètre C2 : seule la transcription
 * est déclarée ici.
 *
 * DONNÉES ENVOYÉES À L'API EXTERNE : le fichier audio (octets) et son type MIME, rien d'autre
 * (pas d'identité, pas de nom de fichier). L'audio n'est jamais conservé côté Flexco par C2.
 */
export interface TranscribeRequest {
  organizationId: string;
  audio: Uint8Array;
  /** Type MIME déduit de la signature binaire (jamais pris tel quel du client). */
  mimeType: "audio/ogg" | "audio/webm" | "audio/mp4" | "audio/mpeg";
  durationSec?: number;
  /** Indice de langue (ex. « fr », « en ») ; absent = détection automatique. */
  languageHint?: string;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  durationSec?: number;
}

export interface SpeechPort {
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
}

/** Transcription impossible pour une raison technique (non configurée, fournisseur en panne). */
export class SpeechUnavailableError extends Error {
  constructor(message = "La transcription vocale n'est pas disponible pour le moment.") {
    super(message);
    this.name = "SpeechUnavailableError";
  }
}
