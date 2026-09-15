import crypto from "node:crypto";
import { env } from "@/lib/env";

/**
 * Primitives cryptographiques du programme d'affiliation — point d'entrée
 * UNIQUE pour tout ce qui touche à `AFFILIATE_LINK_SECRET` (même
 * discipline que le webhook-handler.ts de chaque provider : jamais de
 * `crypto.createHmac` dispersé ailleurs dans le code applicatif).
 *
 * Trois usages distincts du même secret, volontairement séparés par des
 * fonctions dédiées plutôt qu'une seule fonction générique :
 *  1. Signer/vérifier le jeton du cookie `sme_aff` (attribution).
 *  2. Hacher l'IP/user-agent d'un clic (anti-fraude, jamais l'IP en clair).
 *  3. Générer un code de lien court, collision-safe côté appelant.
 */

const COOKIE_TOKEN_SEPARATOR = ".";

export interface ReferralTokenPayload {
  linkId: string;
  affiliateId: string;
  clickId: string;
  /** Expiration en secondes Unix — dérivée de affiliate_cookie_window_days au moment de la signature. */
  exp: number;
}

function requireSecret(): string {
  if (!env.AFFILIATE_LINK_SECRET) {
    throw new Error(
      "AFFILIATE_LINK_SECRET non configuré — impossible de signer/vérifier un lien d'affiliation. " +
        "Voir .env.example et docs/AFFILIATE_SYSTEM.md.",
    );
  }
  return env.AFFILIATE_LINK_SECRET;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

/**
 * Signe un payload d'attribution pour le cookie `sme_aff`. Format
 * volontairement simple (payload base64url + HMAC-SHA256 hex, séparés
 * par un point) plutôt qu'un JWT complet — aucune dépendance externe
 * nécessaire, cohérent avec le reste du projet (aucune lib JWT en
 * dépendance, voir package.json).
 */
export function signReferralToken(payload: ReferralTokenPayload): string {
  const secret = requireSecret();
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("hex");
  return `${encodedPayload}${COOKIE_TOKEN_SEPARATOR}${signature}`;
}

/**
 * Vérifie et décode un jeton de cookie. Renvoie `null` (jamais ne lève)
 * pour TOUT jeton invalide, expiré, ou malformé — un cookie corrompu/
 * périmé/absent doit dégrader silencieusement vers "aucune attribution",
 * jamais faire échouer la création d'organisation qui en dépend (voir
 * onboarding-service.ts::createOrganization).
 */
export function verifyReferralToken(token: string | undefined | null): ReferralTokenPayload | null {
  if (!token) return null;
  if (!env.AFFILIATE_LINK_SECRET) return null;

  const separatorIndex = token.lastIndexOf(COOKIE_TOKEN_SEPARATOR);
  if (separatorIndex <= 0) return null;

  const encodedPayload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);

  const expected = crypto.createHmac("sha256", env.AFFILIATE_LINK_SECRET).update(encodedPayload).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as ReferralTokenPayload;
    if (
      typeof payload.linkId !== "string" ||
      typeof payload.affiliateId !== "string" ||
      typeof payload.clickId !== "string" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    if (payload.exp * 1000 < Date.now()) return null; // expiré
    return payload;
  } catch {
    return null;
  }
}

/**
 * Hache une valeur (IP ou user-agent) avec le même secret plateforme en
 * guise de "poivre" (pepper) — jamais la valeur brute stockée en base
 * (voir affiliate_clicks.ip_hash). Un hash SHA-256 simple suffit ici :
 * l'objectif n'est PAS un stockage de mot de passe (pas besoin de
 * bcrypt/argon2, pas de vérification de correspondance utilisateur),
 * seulement de pouvoir grouper/compter des clics d'une même origine sans
 * conserver de donnée personnelle directement identifiante.
 */
export function hashForFraudDetection(value: string): string {
  const secret = requireSecret();
  return crypto.createHash("sha256").update(`${secret}:${value}`).digest("hex");
}

const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O/1/l/I ambigus
const CODE_LENGTH = 8;

/**
 * Génère un code de lien court, lisible (pas de caractères ambigus type
 * 0/O ou 1/l), prêt à coller dans une bio Instagram/description
 * YouTube. Collision-safe côté appelant uniquement : cette fonction ne
 * vérifie PAS l'unicité — `affiliate-service.ts::createAffiliateLink`
 * retente avec un nouveau code en cas de violation de la contrainte
 * unique `affiliate_links.code` (probabilité de collision négligeable
 * sur 8 caractères parmi 57, mais jamais supposée nulle).
 */
export function generateReferralCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
}

/** Nom + options du cookie d'attribution — centralisé pour que le poseur (/r/[code]) et le lecteur (onboarding-service.ts) restent toujours cohérents. */
export const AFFILIATE_COOKIE_NAME = "sme_aff";
