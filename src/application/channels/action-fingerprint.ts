import { createHash } from "node:crypto";

/**
 * Empreinte d'une action : sha256 hex d'un JSON canonique (clés triées
 * récursivement) de `{ tool, input }`. Un défi StepUp ne vaut QUE pour
 * l'empreinte exacte des paramètres (principe 4 : l'agent ne peut rien
 * modifier après le « oui »).
 *
 * ALIGNEMENT C1 : `pending_actions` porte la même notion d'empreinte. Tant que
 * C1 n'a pas publié sa fonction canonique, celle-ci en est le miroir ; à
 * remplacer par l'export de C1 pour garantir une empreinte unique.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // undefined n'est pas du JSON : normalisé en null pour rester déterministe.
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function computeActionFingerprint(toolName: string, input: unknown): string {
  return createHash("sha256").update(stableStringify({ tool: toolName, input }), "utf8").digest("hex");
}
