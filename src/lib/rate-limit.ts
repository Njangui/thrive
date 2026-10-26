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
 * dans des route handlers / Server Actions runtime Node.js
 * (`/api/webhooks/fapshi/route.ts`, `/api/webhooks/zernio/route.ts`, actions
 * publiques de vitrine), jamais dans `src/proxy.ts` : sous Next 14, son
 * ancêtre `middleware.ts` tournait en Edge Runtime, où une dépendance de
 * `@upstash/redis` utilisant `process.version` (API Node.js) cassait la
 * compatibilité ; depuis Next 16 le proxy tourne en Node.js, mais une
 * défaillance du limiteur y bloquerait TOUTES les requêtes.
 * Voir le commentaire de `src/proxy.ts` pour le détail.
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
// délibérément : ce module est importé par `src/proxy.ts`, sur le
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

/**
 * Q33 : `RATE_LIMIT_REQUIRED=true` (drapeau explicite, défaut : désactivé) refuse les requêtes limitées
 * lorsqu'Upstash n'est pas configuré, au lieu de laisser passer silencieusement. Les webhooks restent
 * ouverts : ils sont authentifiés par signature et un refus ferait perdre des paiements.
 * Panne Redis (audit RL2) : repli OUVERT + alerte dans les logs, jamais une erreur 500.
 */
export function isRateLimitRequired(): boolean {
  return process.env.RATE_LIMIT_REQUIRED === "true";
}

let lastAlertAt = 0;
const ALERT_EVERY_MS = 5 * 60 * 1000;
export function reportRateLimitFailure(context: string, error?: unknown) {
  const now = Date.now();
  if (now - lastAlertAt < ALERT_EVERY_MS) return;
  lastAlertAt = now;
  console.error(`[ALERTE rate-limit] ${context}`, error instanceof Error ? error.message : (error ?? ""));
}

const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

/** 60 requêtes / 10s par IP (audit RL3 : 10 refusait des rafales légitimes) — webhooks provider (Zernio/Fapshi signent/authentifient leurs requêtes, mais un minimum de défense en profondeur reste utile contre un flood). */
const webhookLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "10 s"), prefix: "ratelimit:webhook" })
  : null;

/** 5 tentatives / 60s par IP — protection basique contre le bruteforce sur la connexion. */
const authLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "60 s"), prefix: "ratelimit:auth" })
  : null;

/** 5 soumissions / 60s par IP — formulaire public de liste d'attente pays (section 54), pas d'authentification donc pas de compte à bloquer, seule l'IP protège contre un flood. */
const waitlistLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "60 s"), prefix: "ratelimit:waitlist" })
  : null;

/**
 * 5 demandes / 60s par IP — formulaire public de prise de rendez-vous de
 * la vitrine tenant (`requestAppointmentAction`, chantier vitrine V2).
 * Même situation que `waitlistLimiter` : aucune session, donc l'IP est le
 * seul signal disponible. Repose sur la MÊME clé Redis (préfixe
 * `ratelimit:booking`) quel que soit le tenant visé — délibéré : une IP
 * qui flood les formulaires de rendez-vous de plusieurs boutiques à la
 * suite est un abus au niveau de la plateforme, pas un problème propre à
 * un tenant, et chaque demande déclenche déjà une notification au
 * commerçant (`notifyOrgAdmins`) qu'il ne faut pas laisser spammer.
 */
const bookingLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "60 s"), prefix: "ratelimit:booking" })
  : null;

/**
 * 30 requêtes / 60s par IP — route publique /r/[code] (programme
 * d'affiliation, 0044). Plus généreux que `waitlist` : un lien
 * d'affiliation peut être partagé sur un post viral et recevoir un vrai
 * pic de trafic légitime en peu de temps — la détection de vélocité
 * fine (par ip_hash, voir affiliate.ts::exceedsClickVelocity) reste le
 * garde-fou anti-fraude ; ce limiteur-ci n'est qu'une protection anti-flood
 * basique, pas une mesure anti-fraude.
 */
const affiliateClickLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, "60 s"), prefix: "ratelimit:affiliate_click" })
  : null;

/** 120 événements / 60s par IP — analytics publiques des vitrines.
 * Ce limiteur protège les Server Actions publiques contre le remplissage
 * artificiel de `analytics_events` et les coûts DB associés.
 */
const publicAnalyticsLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, "60 s"), prefix: "ratelimit:public_analytics" })
  : null;

/**
 * 20 messages / 60s par UTILISATEUR (pas par IP : plusieurs employés derrière la
 * même box 4G ne doivent pas se bloquer) — chat propriétaire (C2). Chaque
 * message peut déclencher des appels de modèle payants : protection de coût.
 */
const assistantLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20, "60 s"), prefix: "ratelimit:assistant" })
  : null;

/** 10 envois de fichiers / 60s par utilisateur — pièces jointes du chat (C2). */
const assistantUploadLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "60 s"), prefix: "ratelimit:assistant_upload" })
  : null;

/**
 * 5 tentatives / 60s par identifiant Telegram — liaison `/start CODE` du bot
 * back-office (C2). Le code fait 50 bits et expire en 10 min : ce plafond rend
 * la devinette en ligne hors de portée, et protège aussi contre le flood.
 */
const channelLinkLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "60 s"), prefix: "ratelimit:channel_link" })
  : null;

/** 30 messages / 60s par numéro WhatsApp — garde-fou anti-flood du back-office WhatsApp avant tout accès base. */
const whatsappBackofficeLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, "60 s"), prefix: "ratelimit:whatsapp_backoffice" })
  : null;

/** 10 transcriptions vocales / 60s par utilisateur — chaque vocal est un appel facturé chez le fournisseur de transcription (C2, livrable F). */
const voiceTranscriptionLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "60 s"), prefix: "ratelimit:voice_transcription" })
  : null;

/** 40 mises à jour / 60s par identifiant Telegram — garde-fou anti-flood du bot back-office avant tout accès base. */
const telegramBackofficeLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(40, "60 s"), prefix: "ratelimit:telegram_backoffice" })
  : null;

export type RateLimitKind =
  | "webhook" | "auth" | "waitlist" | "affiliate_click" | "booking" | "public_analytics"
  | "assistant" | "assistant_upload" | "channel_link" | "telegram_backoffice" | "whatsapp_backoffice" | "voice_transcription";

/**
 * Retourne `null` quand la requête est autorisée à continuer (soit
 * réellement dans la limite, soit rate limiting non configuré — repli
 * ouvert, jamais fermé, voir en-tête de fichier). Retourne un nombre de
 * secondes avant réessai quand la requête doit être refusée.
 */
export async function checkRateLimit(kind: RateLimitKind, identifier: string): Promise<number | null> {
  const limiter =
    kind === "webhook"
      ? webhookLimiter
      : kind === "waitlist"
        ? waitlistLimiter
        : kind === "affiliate_click"
          ? affiliateClickLimiter
          : kind === "booking"
            ? bookingLimiter
            : kind === "public_analytics"
              ? publicAnalyticsLimiter
              : kind === "assistant"
                ? assistantLimiter
                : kind === "assistant_upload"
                  ? assistantUploadLimiter
                  : kind === "channel_link"
                    ? channelLinkLimiter
                    : kind === "telegram_backoffice"
                      ? telegramBackofficeLimiter
                      : kind === "whatsapp_backoffice"
                        ? whatsappBackofficeLimiter
                        : kind === "voice_transcription"
                          ? voiceTranscriptionLimiter
                          : authLimiter;
  if (!limiter) {
    if (isRateLimitRequired() && kind !== "webhook") {
      reportRateLimitFailure("RATE_LIMIT_REQUIRED=true mais Upstash n'est pas configuré : requêtes limitées refusées.");
      return 60;
    }
    warnNotConfigured();
    return null;
  }

  try {
    const { success, reset } = await limiter.limit(identifier);
    if (success) return null;
    return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  } catch (error) {
    reportRateLimitFailure(`Upstash indisponible (${kind}) : repli ouvert.`, error);
    return null;
  }
}
