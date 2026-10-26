/**
 * Garde-fou : un texte qui ressemble à un secret n'est ni mémorisé ni envoyé à
 * un fournisseur d'embeddings (aucun secret dans les prompts ni les logs).
 * Heuristique volontairement prudente (faux positifs acceptés).
 */
const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /\b(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{16,}/i, // clés d'API usuelles
  /\b(api[_-]?key|secret|token|passwd|password|mot de passe|mdp)\s*[:=]\s*\S{6,}/i,
  /\b[A-Za-z0-9+/_-]{40,}={0,2}(?=\s|$)/, // longue chaîne opaque
];

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function looksLikeSecret(text: string): boolean {
  if (PATTERNS.some((p) => p.test(text))) return true;
  // Numéro de carte : 13 à 19 chiffres (espaces/tirets tolérés) valides au contrôle de Luhn.
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}
