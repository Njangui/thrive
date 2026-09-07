import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate limiting — absent jusqu'ici sur tout le projet (webhooks provider).
 * Voir COMPARAISON_MASTER_PROMPT.md, section "Avant toute mise en
 * production réelle".
 *
 * Upstash Redis choisi plutôt qu'un compteur en mémoire : les route
 * handlers Next.js tournent en fonctions serverless (Vercel), sans état
 * partagé garanti entre deux invocations successives — un compteur en
 * mémoire donnerait une fausse impression de protection. Upstash est le
 * choix standard pour ce cas avec Next.js/Vercel. Utilisé UNIQUEMENT
 * dans des route handlers runtime Node.js (`/api/webhooks/notchpay/
 * route.ts`), jamais dans `src/middleware.ts` — ce dernier tourne en Edge
 * Runtime, où une dépendance de `@upstash/redis` utilisant `process.version`
 * (API Node.js) casse la compatibilité (avertissement au build : "A
 * Node.js API is used ... which is not supported in the Edge Runtime").
 * Voir le commentaire de `src/middleware.ts` pour le détail.
 *
 * Repli explicite si non configuré (`UPSTASH_REDIS_REST_URL`/
 * `UPSTASH_REDIS_REST_TOKEN` absents) : ne bloque JAMAIS l'application au
 * démarrage — avertit une fois et laisse passer, même principe que
 * `getEmailProvider()`/`getDomainProvider()` (repli propre plutôt qu'un
 * crash). Le rate limiting reste alors désactivé jusqu'à configuration.
 */
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
// Lues directement sur `process.env` plutôt que via `src/lib/env.ts`,
// délibérément : ce module est importé par `src/middleware.ts`, sur le
// chemin critique de CHAQUE requête (résolution tenant comprise).
// `env.ts` échoue fort et bloquerait alors TOUTE requête si jamais une
// variable Supabase venait à manquer — un risque bien plus large que la
// seule fonctionnalité de rate limiting. Documenté ici pour que cet écart
// à la convention ("toute variable doit être déclarée dans env.ts") ne
// ressemble pas à un oubli.

let warnedOnce = false;
function warnNotConfigured() {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN non configurés — rate limiting désactivé (voir docs/DEPLOYMENT.md).",
  );
}

const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

/** 10 requêtes / 10s par IP — webhooks provider (Zernio/NotchPay signent leurs requêtes, mais un minimum de défense en profondeur reste utile contre un flood). */
const webhookLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "10 s"), prefix: "ratelimit:webhook" })
  : null;

/** 5 tentatives / 60s par IP — protection basique contre le bruteforce sur la connexion. */
const authLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "60 s"), prefix: "ratelimit:auth" })
  : null;

export type RateLimitKind = "webhook" | "auth";

/**
 * Retourne `null` quand la requête est autorisée à continuer (soit
 * réellement dans la limite, soit rate limiting non configuré — repli
 * ouvert, jamais fermé, voir en-tête de fichier). Retourne un nombre de
 * secondes avant réessai quand la requête doit être refusée.
 */
export async function checkRateLimit(kind: RateLimitKind, identifier: string): Promise<number | null> {
  const limiter = kind === "webhook" ? webhookLimiter : authLimiter;
  if (!limiter) {
    warnNotConfigured();
    return null;
  }

  const { success, reset } = await limiter.limit(identifier);
  if (success) return null;
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}
