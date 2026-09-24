import { z } from "zod";

/**
 * Toute variable d'environnement utilisée côté serveur doit être déclarée
 * ici. Échoue vite et fort si une variable requise manque, plutôt que de
 * planter silencieusement en profondeur dans un adapter (section 54).
 */
const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_ROOT_DOMAIN: z.string().default("localhost:3000"),

  ZERNIO_API_KEY: z.string().optional(),
  ZERNIO_API_BASE_URL: z.string().url().default("https://zernio.com/api/v1"),
  ZERNIO_WEBHOOK_SIGNING_SECRET: z.string().optional(),

  // YouTube natif : OAuth Google, indépendant des connecteurs sociaux tiers.
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_OAUTH_STATE_SECRET: z.string().optional(),

  AI_PROVIDER_DEFAULT: z.enum(["mistral", "claude", "openai"]).default("mistral"),
  MISTRAL_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Migré NotchPay -> Fapshi le 2026-09-20 : Fapshi est le seul adapter
  // réellement implémenté — "cinetpay" ferait échouer getPaymentProvider()
  // volontairement (voir registry.ts), scaffolding orphelin conservé tel
  // quel. Si votre .env contient encore PAYMENT_PROVIDER_DEFAULT=notchpay,
  // ce schéma le refusera au démarrage (fail fast) — mettez-le à jour vers
  // "fapshi" et renseignez les variables FAPSHI_* ci-dessous.
  PAYMENT_PROVIDER_DEFAULT: z.enum(["cinetpay", "fapshi"]).default("fapshi"),
  CINETPAY_API_KEY: z.string().optional(),
  CINETPAY_SITE_ID: z.string().optional(),
  // Fapshi authentifie avec DEUX valeurs (contrairement à NotchPay qui
  // n'en exigeait qu'une) — voir payment/fapshi/client.ts.
  FAPSHI_API_USER: z.string().optional(),
  FAPSHI_API_KEY: z.string().optional(),
  // Secret webhook Fapshi — un simple secret partagé (PAS une clé HMAC
  // comme NotchPay), configuré une seule fois côté dashboard Fapshi et
  // jamais relisible ensuite. Voir payment/fapshi/webhook-handler.ts.
  FAPSHI_WEBHOOK_SECRET: z.string().optional(),
  // sandbox.fapshi.com pour les tests, live.fapshi.com par défaut — voir
  // docs.fapshi.com (section "The Environment").
  FAPSHI_BASE_URL: z.string().url().default("https://live.fapshi.com"),

  // Lot N, Partie 2 — OpenProvider (registrar de domaines, voir
  // RAPPORT_LOT_G.md pour l'évaluation initiale et RAPPORT_LOT_N.md pour
  // l'intégration). Compte reseller UNIQUE pour toute la plateforme (même
  // raisonnement que NotchPay : aucun commerçant n'a son propre compte
  // OpenProvider). Optionnelles : en leur absence, registry.ts::getDomainProvider()
  // retombe sur ManualDomainAdapter sans casser le flux existant.
  OPENPROVIDER_USERNAME: z.string().optional(),
  OPENPROVIDER_PASSWORD: z.string().optional(),

  ENABLE_AI_INSIGHTS: z.coerce.boolean().default(true),
  ENABLE_AUTOMATION_ENGINE: z.coerce.boolean().default(false),

  // Lot F — secret partagé pour protéger /api/cron/* (le déclencheur cron
  // externe — cron-job.org, Vercel Cron... — l'envoie en
  // `Authorization: Bearer <CRON_SECRET>`). Optionnel : en son absence la
  // route reste accessible en clair, avec un avertissement bruyant au
  // démarrage plutôt qu'un blocage silencieux — cohérent avec le reste de
  // ce fichier (section 54 : échouer fort, pas en silence — voir route.ts).
  CRON_SECRET: z.string().optional(),

  // Lot I, Partie 1 — Web Push (notifications PWA). Optionnelles : en leur
  // absence, push-service.ts::sendPush() ne fait rien (pas d'erreur, pas de
  // notification envoyée) et le toggle de dashboard/notifications reste
  // masqué — cohérent avec le reste du projet (IA, paiement... désactivés
  // proprement tant que non configurés, jamais un crash). Générer une paire
  // avec `npx web-push generate-vapid-keys`.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@scholarmach.com"),

  // Lot L, Partie 1 — EmailProvider (invitations d'équipe). Optionnelle :
  // en son absence, getEmailProvider() (registry.ts) retombe sur
  // ConsoleLogEmailAdapter (log clair, jamais un crash ni un faux succès).
  // ATTENTION (vérifié sur resend.com, voir infrastructure/providers/email/resend/types.ts) :
  // tant qu'aucun domaine n'est vérifié dans le compte Resend, seule
  // l'adresse resend.dev fonctionne, et UNIQUEMENT vers l'email du
  // titulaire du compte — pas vers un vrai destinataire d'invitation.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().default("tokoo  <onboarding@resend.dev>"),

  // --- Programme d'affiliation (0044_affiliate_system.sql) — secret de
  // signature HMAC des jetons de cookie d'attribution
  // (affiliate-link-security.ts) ET pepper de hachage IP/user-agent
  // anti-fraude. Optionnel pour ne jamais bloquer un déploiement qui
  // n'active pas encore le programme : tant qu'il est absent,
  // /r/[code] répond 503 explicite plutôt que de signer un cookie avec
  // un secret vide (voir affiliate-link-security.ts::requireSecret).
  AFFILIATE_LINK_SECRET: z.string().optional(),

  // --- Telegram — canal de notification INDÉPENDANT de Zernio
  // (docs/TELEGRAM_INTEGRATION.md). Utilisé pour : (1) les alertes
  // admin plateforme (nouvelle candidature affilié, fraude détectée,
  // demande de paiement) via NotificationProvider
  // (infrastructure/providers/telegram/adapter.ts), et (2) le bot
  // affilié (stats, liaison de compte, commandes /mystats /payout).
  // Optionnelles : en leur absence, getNotificationProvider() (registry.ts)
  // retombe sur un adapter "console log" muet, jamais un crash — même
  // philosophie que RESEND_API_KEY/OPENPROVIDER_*.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // Valeur arbitraire choisie à la configuration du webhook
  // (setWebhook `secret_token`), jamais un HMAC du corps — Telegram la
  // renvoie telle quelle dans le header
  // `X-Telegram-Bot-Api-Secret-Token` à chaque delivery, voir
  // infrastructure/providers/telegram/webhook-handler.ts.
  TELEGRAM_BOT_WEBHOOK_SECRET: z.string().optional(),
  // Nom d'utilisateur du bot SANS le @ (ex: "smeos_partenaires_bot") —
  // sert à construire les liens de liaison profonds
  // `https://t.me/<username>?start=<token>` affichés dans
  // /affiliate/dashboard/telegram.
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  // Identifiant du chat/groupe Telegram recevant les alertes de
  // l'opérateur plateforme (peut être négatif pour un groupe/supergroupe
  // Telegram — d'où `string`, jamais coercé en `number`).
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
});

function loadEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Volontairement bruyant : mieux vaut un crash au démarrage qu'un
    // comportement silencieusement dégradé en production.
    console.error("❌ Variables d'environnement invalides :", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration — voir .env.example");
  }
  return parsed.data;
}

export const env = loadEnv();
