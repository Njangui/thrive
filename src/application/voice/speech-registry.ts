import { SpeechUnavailableError, type SpeechPort } from "@/domain/ports/speech-port";

/** Adaptateur par défaut tant que C3 n'a pas livré le sien. */
export const unavailableSpeechPort: SpeechPort = {
  async transcribe() {
    throw new SpeechUnavailableError();
  },
};

let port: SpeechPort = unavailableSpeechPort;

/** C3 appelle `registerSpeechPort(adapter)` au démarrage ; `null` rétablit l'adaptateur indisponible (tests). */
export function registerSpeechPort(next: SpeechPort | null): void {
  port = next ?? unavailableSpeechPort;
}

export function getSpeechPort(): SpeechPort {
  return port;
}
