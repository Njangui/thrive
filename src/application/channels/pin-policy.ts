/**
 * Politique de PIN et de verrouillage — fonctions pures, testées.
 * Les compteurs sont tenus en base (fonction `step_up_record_failure`, avec
 * verrou de ligne) ; ces constantes sont passées en paramètres à la fonction
 * pour garder une seule source de vérité côté code.
 */
export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 8;
export const PIN_MAX_ATTEMPTS = 5;
/** Premier verrouillage : 5 min, puis ×2 à chaque palier (plafonné à 24 h en SQL). */
export const PIN_BASE_LOCK_SECONDS = 300;

export type PinFormatError = "format" | "too_weak";

/**
 * 6 à 8 chiffres. Refuse les PIN triviaux : un seul chiffre répété (000000),
 * suites strictement croissantes/décroissantes (123456, 654321), motifs
 * répétés (121212, 123123). Le PIN ne protège que contre une personne ayant
 * déjà accès au canal (SIM échangée, téléphone volé) : un PIN devinable en
 * quelques essais annulerait ce rôle malgré le verrouillage.
 */
export function validatePinFormat(pin: string): { ok: true } | { ok: false; error: PinFormatError } {
  if (!new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin)) return { ok: false, error: "format" };
  if (isTrivialPin(pin)) return { ok: false, error: "too_weak" };
  return { ok: true };
}

function isTrivialPin(pin: string): boolean {
  const digits = [...pin].map(Number);
  if (digits.every((d) => d === digits[0])) return true;
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  // Motif répété (période 1 à moitié de la longueur) : 1212 12, 123123.
  for (let period = 1; period <= Math.floor(pin.length / 2); period++) {
    if (pin.length % period === 0 && pin === pin.slice(0, period).repeat(pin.length / period)) return true;
  }
  return false;
}
