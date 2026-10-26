/**
 * Canonicalisation, empreinte et expurgation des paramètres d'outil.
 * Aucune dépendance runtime hors `node:crypto` : utilisable partout.
 */
import { createHash } from "node:crypto";

/**
 * JSON stable : clés triées, `undefined` d'objet omis, nombres finis
 * uniquement, Date -> ISO. Deux paramètres équivalents donnent la même chaîne ;
 * toute différence de valeur en donne une autre.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) throw new TypeError("canonicalize: undefined au niveau racine");
  return encode(value);
}

function encode(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalize: nombre non fini");
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalize: type non supporté (${typeof value})`);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError("canonicalize: date invalide");
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : encode(item))).join(",")}]`;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError("canonicalize: objet non simple (Map, Set, classe…)");
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${encode(record[key])}`);
  return `{${parts.join(",")}}`;
}

/** Empreinte SHA-256 (hex) liant tenant, outil et paramètres EXACTS. */
export function paramsHash(tenantId: string, toolName: string, params: unknown): string {
  return createHash("sha256")
    .update(canonicalize({ tenantId, toolName, params: params ?? null }))
    .digest("hex");
}

const SECRET_KEY = /^(pin|otp|cvv|iban)$|pass(word|wd)?|token|secret|authorization|api[-_]?key|credential|card[-_]?number/i;
const MAX_DEPTH = 6;

/** Copie expurgée pour audit / carte d'approbation : secrets masqués, chaînes tronquées. */
export function redactParams(value: unknown, maxString = 200, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    return value.length > maxString ? `${value.slice(0, maxString)}…[tronqué]` : value;
  }
  if (typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[profondeur max]";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactParams(item, maxString, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? "[REDACTED]" : redactParams(item, maxString, depth + 1);
  }
  return out;
}
