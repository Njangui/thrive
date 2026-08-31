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

  PAYMENT_PROVIDER_DEFAULT: z.enum(["cinetpay", "notchpay"]).default("cinetpay"),
  CINETPAY_API_KEY: z.string().optional(),
  CINETPAY_SITE_ID: z.string().optional(),
  NOTCHPAY_API_KEY: z.string().optional(),

  ENABLE_AI_INSIGHTS: z.coerce.boolean().default(true),
  ENABLE_AUTOMATION_ENGINE: z.coerce.boolean().default(false),
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
