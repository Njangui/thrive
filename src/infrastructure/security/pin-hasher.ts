import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Hachage de PIN — scrypt (node:crypto, aucune dépendance native).
 *
 * Format stocké : `scrypt$N$r$p$saltB64$hashB64`. Les paramètres sont dans la
 * chaîne : on peut les durcir plus tard sans invalider les PIN existants
 * (`needsRehash`). Un « poivre » serveur optionnel (`STEP_UP_PIN_PEPPER`) est
 * mélangé au PIN avant hachage : une fuite de la seule base ne suffit alors pas
 * à une attaque hors ligne (l'espace de 10^6 PIN est sinon trivial à énumérer
 * — c'est pourquoi le poivre ET le verrouillage en ligne comptent).
 */
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEM = 64 * 1024 * 1024;

function scryptAsync(secret: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, keylen, options, (error, derived) => (error ? reject(error) : resolve(derived)));
  });
}

function withPepper(pin: string, pepper?: string): string {
  return pepper ? `${pepper}:${pin}` : pin;
}

export async function hashPin(pin: string, pepper?: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(withPepper(pin, pepper), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64"), derived.toString("base64")].join("$");
}

export async function verifyPinHash(pin: string, stored: string, pepper?: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (![N, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const expected = Buffer.from(hashB64, "base64");
  if (expected.length === 0) return false;
  try {
    const derived = await scryptAsync(withPepper(pin, pepper), Buffer.from(saltB64, "base64"), expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(MAX_MEM, 256 * N * r),
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  return parts.length !== 6 || Number(parts[1]) < SCRYPT_N || Number(parts[2]) < SCRYPT_R || Number(parts[3]) < SCRYPT_P;
}
