import type { AgentActor } from "@/application/channels/actor";
import { SpeechUnavailableError, type SpeechPort } from "@/domain/ports/speech-port";
import { checkRateLimit, type RateLimitKind } from "@/lib/rate-limit";
import { getSpeechPort } from "@/application/voice/speech-registry";
import { checkAudio, looksLikeDictatedSecret, normalizeTranscript, voiceMessage } from "@/application/voice/voice-policy";

/**
 * Commandes vocales (livrable F) : audio → SpeechPort (C3) → TEXTE, puis le même flux que le texte.
 *
 * Garanties :
 *  - la transcription est une DONNÉE de l'utilisateur authentifié, jamais une instruction système ;
 *  - un vocal ne VALIDE jamais rien : les approbations passent par boutons / tableau de bord, le
 *    texte transcrit n'a aucun chemin vers `approve` ;
 *  - un PIN dicté n'est ni transmis à l'agent ni enregistré (mais il a déjà quitté l'appareil vers
 *    le fournisseur : l'avertissement l'indique) ;
 *  - l'audio n'est pas conservé ; seules des métadonnées sont journalisées, jamais le contenu.
 */
export type VoiceSource = "dashboard" | "telegram" | "whatsapp";
export type VoiceFailure = "too_large" | "too_long" | "bad_format" | "empty_audio" | "unavailable" | "rate_limited" | "empty" | "secret_dictated" | "failed";

export type VoiceResult =
  | { ok: true; text: string; language?: string }
  | { ok: false; reason: VoiceFailure; message: string };

export interface VoiceUsageEvent { organizationId: string; userId: string; source: VoiceSource; bytes: number; durationSec?: number; chars: number }

export interface VoiceDeps {
  speech: SpeechPort;
  rateLimit: (kind: RateLimitKind, id: string) => Promise<number | null>;
  /** Point d'accroche du registre d'usage de C1 (coût). Par défaut : journal sans contenu. */
  onUsage: (event: VoiceUsageEvent) => void | Promise<void>;
}

export function defaultVoiceDeps(): VoiceDeps {
  return {
    get speech() { return getSpeechPort(); },
    rateLimit: checkRateLimit,
    onUsage: (e) => console.info(`[voice] transcription org=${e.organizationId} user=${e.userId} via=${e.source} octets=${e.bytes} durée=${e.durationSec ?? "?"}s caractères=${e.chars}`),
  };
}

const fail = (reason: VoiceFailure): VoiceResult => ({ ok: false, reason, message: voiceMessage(reason) });

export async function transcribeVoice(
  input: { actor: AgentActor; source: VoiceSource; bytes: Uint8Array; durationSec?: number },
  deps: VoiceDeps = defaultVoiceDeps(),
): Promise<VoiceResult> {
  const audio = checkAudio({ bytes: input.bytes, durationSec: input.durationSec });
  if (!audio.ok) return fail(audio.reason);

  if ((await deps.rateLimit("voice_transcription", input.actor.userId)) !== null) return fail("rate_limited");

  let result;
  try {
    result = await deps.speech.transcribe({ organizationId: input.actor.tenantId, audio: input.bytes, mimeType: audio.mimeType, durationSec: input.durationSec });
  } catch (error) {
    if (error instanceof SpeechUnavailableError) return fail("unavailable");
    console.error("[voice] transcription en échec:", error instanceof Error ? error.message : "inconnue");
    return fail("failed");
  }

  const text = normalizeTranscript(result.text);
  try { await deps.onUsage({ organizationId: input.actor.tenantId, userId: input.actor.userId, source: input.source, bytes: input.bytes.byteLength, durationSec: result.durationSec ?? input.durationSec, chars: text.length }); }
  catch (error) { console.warn("[voice] usage non enregistré:", error instanceof Error ? error.message : error); }

  if (!text) return fail("empty");
  if (looksLikeDictatedSecret(text)) return fail("secret_dictated");
  return { ok: true, text, language: result.language };
}

/** Écho montré à l'utilisateur avant l'action : il voit ce que le système a compris (chiffres, quantités). */
export function transcriptEcho(text: string): string {
  return `🎤 J'ai compris : « ${text.slice(0, 600)}${text.length > 600 ? "…" : ""} »`;
}
