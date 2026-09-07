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

  AI_PROVIDER_DEFAULT: z.enum(["mistral", "claude", "openai"]).default("mistral"),
  MISTRAL_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Lot G : NotchPay est le seul adapter réellement implémenté — "cinetpay"
  // ferait échouer getPaymentProvider() volontairement (voir registry.ts).
  PAYMENT_PROVIDER_DEFAULT: z.enum(["cinetpay", "notchpay"]).default("notchpay"),
  CINETPAY_API_KEY: z.string().optional(),
  CINETPAY_SITE_ID: z.string().optional(),
  NOTCHPAY_API_KEY: z.string().optional(),
  NOTCHPAY_WEBHOOK_SECRET: z.string().optional(),

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
  VAPID_SUBJECT: z.string().default("mailto:support@sme-os.app"),

  // Lot L, Partie 1 — EmailProvider (invitations d'équipe). Optionnelle :
  // en son absence, getEmailProvider() (registry.ts) retombe sur
  // ConsoleLogEmailAdapter (log clair, jamais un crash ni un faux succès).
  // ATTENTION (vérifié sur resend.com, voir infrastructure/providers/email/resend/types.ts) :
  // tant qu'aucun domaine n'est vérifié dans le compte Resend, seule
  // l'adresse resend.dev fonctionne, et UNIQUEMENT vers l'email du
  // titulaire du compte — pas vers un vrai destinataire d'invitation.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().default("SME-OS <onboarding@resend.dev>"),
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
