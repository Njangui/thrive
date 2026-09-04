import type { AIProvider } from "@/domain/ports/ai-provider";
import type { MessagingProvider } from "@/domain/ports/messaging-provider";
import type { SocialPublishingProvider } from "@/domain/ports/social-publishing-provider";
import type { StorageProvider } from "@/domain/ports/storage-provider";
import type { PaymentProvider } from "@/domain/ports/payment-provider";
import type { DomainProvider } from "@/domain/ports/domain-provider";
import type { EmailProvider } from "@/domain/ports/email-provider";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { env } from "@/lib/env";
import { ZernioAdapter } from "./messaging/zernio/adapter";
import { ZernioClient } from "./messaging/zernio/client";
import { ZernioSocialAdapter } from "./social/zernio/adapter";
import { ZernioSocialClient } from "./social/zernio/client";
import { MistralAdapter } from "./ai/mistral-adapter";
import { ClaudeAdapter } from "./ai/claude-adapter";
import { OpenAIAdapter } from "./ai/openai-adapter";
import { SupabaseStorageAdapter } from "./storage/supabase-storage-adapter";
import { NotchPayAdapter } from "./payment/notchpay/adapter";
import { NotchPayClient } from "./payment/notchpay/client";
import { ManualDomainAdapter } from "./domain/manual/adapter";
import { OpenProviderAdapter } from "./domain/openprovider/adapter";
import { OpenProviderClient } from "./domain/openprovider/client";
import { ResendAdapter } from "./email/resend/adapter";
import { ResendClient } from "./email/resend/client";
import { ConsoleLogEmailAdapter } from "./email/console-log/adapter";
import { resolveProviderCredential, resolveCredential } from "./secrets-resolver";

/**
 * ProviderRegistry (section 58) : les services applicatifs appellent
 * `getMessagingProvider(orgId)` / `getAIProvider(orgId)` — jamais
 * `new ZernioAdapter(...)` directement. C'est ce qui permet de changer de
 * fournisseur pour un tenant sans toucher au domaine ni à l'application.
 */

/**
 * StorageProvider (Lot E, Partie 1) : contrairement à Messaging/AI/Social,
 * il n'existe qu'un seul provider de stockage pour toute la plateforme en
 * V1 (pas de `provider_connections` par tenant — le stockage n'est pas un
 * choix commerçant). `organizationId` est quand même accepté pour rester
 * cohérent avec le pattern du registry et permettre une résolution
 * per-tenant plus tard (ex: whitelabel avec bucket dédié) sans casser les
 * appelants.
 */
export async function getStorageProvider(_organizationId: string): Promise<StorageProvider> {
  return new SupabaseStorageAdapter();
}

/**
 * PaymentProvider (Lot G, Partie 1) : même posture que StorageProvider —
 * un abonnement se paie AU platform (une seule ligne comptable NotchPay
 * plateforme), pas à un compte NotchPay propre à chaque tenant. Pas de
 * lookup `provider_connections` ici (ça n'aurait pas de sens : aucun
 * commerçant ne "connecte" son propre NotchPay pour payer SME-OS).
 * `organizationId` accepté pour la même raison que StorageProvider : ne
 * pas casser les appelants si un jour plusieurs comptes providers
 * plateforme coexistent (ex: NotchPay + CinetPay selon la devise/pays).
 */
export async function getPaymentProvider(_organizationId: string): Promise<PaymentProvider> {
  // Branche sur PAYMENT_PROVIDER_DEFAULT (env.ts) plutôt que de renvoyer
  // NotchPay en dur — même discipline switch/default que
  // getMessagingProvider/getAIProvider, pour que l'ajout futur d'un
  // adapter CinetPay n'implique de toucher que ce switch. Lot G : seul
  // "notchpay" est réellement implémenté (voir RAPPORT_LOT_G.md) — la
  // valeur par défaut d'env.ts a été corrigée de "cinetpay" (jamais
  // implémenté, scaffolding orphelin) vers "notchpay" en conséquence.
  switch (env.PAYMENT_PROVIDER_DEFAULT) {
    case "notchpay": {
      const apiKey = resolveProviderCredential("notchpay");
      return new NotchPayAdapter(new NotchPayClient(apiKey));
    }
    default:
      throw new Error(`PaymentProvider "${env.PAYMENT_PROVIDER_DEFAULT}" non implémenté.`);
  }
}

/**
 * DomainProvider (Lot G, Partie 3 ; intégration réelle Lot N, Partie 2) :
 * un seul provider plateforme, pas de choix par tenant (même raisonnement
 * que PaymentProvider ci-dessus — un seul compte reseller OpenProvider
 * pour toute la plateforme). Actif dès que OPENPROVIDER_USERNAME/PASSWORD
 * sont configurés ; repli automatique sur ManualDomainAdapter sinon — ne
 * casse jamais un déploiement qui n'a pas encore ce fournisseur configuré
 * (voir RAPPORT_LOT_N.md).
 */
export async function getDomainProvider(_organizationId: string): Promise<DomainProvider> {
  if (env.OPENPROVIDER_USERNAME && env.OPENPROVIDER_PASSWORD) {
    return new OpenProviderAdapter(new OpenProviderClient(env.OPENPROVIDER_USERNAME, env.OPENPROVIDER_PASSWORD));
  }
  return new ManualDomainAdapter();
}

/**
 * EmailProvider (Lot L) : un seul provider plateforme — un email
 * transactionnel (invitation d'équipe...) part toujours du compte Resend
 * de la plateforme, jamais d'un compte propre à chaque tenant (même
 * raisonnement que Storage/Payment/Domain ci-dessus).
 *
 * Volontairement PAS de `resolveProviderCredential("resend")` ici : cette
 * fonction lève une exception quand la clé manque, alors que le cahier
 * exige explicitement un repli silencieux-mais-loggé (jamais un crash)
 * quand aucune clé email n'est configurée — cohérent avec le reste du
 * projet où l'IA/le paiement restent désactivés proprement tant que non
 * configurés. Lecture directe de `env.RESEND_API_KEY` pour ce choix
 * précis d'adapter.
 */
export async function getEmailProvider(): Promise<EmailProvider> {
  if (!env.RESEND_API_KEY) {
    return new ConsoleLogEmailAdapter();
  }
  return new ResendAdapter(new ResendClient(env.RESEND_API_KEY), env.EMAIL_FROM_ADDRESS);
}

export async function getMessagingProvider(organizationId: string): Promise<MessagingProvider> {
  const supabase = getSupabaseServiceClient();

  const { data: connection, error } = await supabase
    .from("provider_connections")
    .select("provider_name, status, metadata")
    .eq("organization_id", organizationId)
    .eq("provider_type", "messaging")
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture provider_connections: ${error.message}`);
  if (!connection) {
    throw new Error(
      `Aucun MessagingProvider connecté pour l'organization ${organizationId}. ` +
        `Complétez l'onboarding (section 31) avant d'envoyer/recevoir des messages.`,
    );
  }

  switch (connection.provider_name) {
    case "zernio": {
      const metadata = (connection.metadata ?? {}) as { profileId?: string; accountId?: string };
      if (!metadata.profileId || !metadata.accountId) {
        throw new Error(
          `provider_connections.metadata incomplet pour zernio (profileId/accountId manquants), org ${organizationId}`,
        );
      }
      const apiKey = await resolveCredential(organizationId, "messaging", "zernio");
      return new ZernioAdapter(new ZernioClient(apiKey), metadata.profileId, metadata.accountId);
    }
    default:
      throw new Error(`MessagingProvider "${connection.provider_name}" non implémenté.`);
  }
}

interface AIProviderBundle {
  primary: AIProvider;
  fallback: AIProvider | null;
}

/**
 * Lot L, Partie 2 — source unique de vérité pour "quels providers IA
 * existent réellement" : `ai-config-service.ts` (validation) ET
 * `/dashboard/ai` (menu déroulant) importent CE tableau plutôt que de
 * coder leur propre liste, pour ne jamais diverger du switch de
 * `buildAIAdapter` ci-dessous (cahier : "PAS une liste codée en dur qui
 * pourrait diverger de registry.ts").
 */
export const AI_PROVIDER_NAMES = ["mistral", "claude", "openai"] as const;
export type AIProviderName = (typeof AI_PROVIDER_NAMES)[number];

/**
 * Modèle par défaut appliqué automatiquement quand un tenant choisit ce
 * provider depuis `/dashboard/ai` (ai-config-service.ts) — jamais exposé
 * comme champ libre à l'utilisateur (cahier : vocabulaire non technique,
 * "model" ne doit pas apparaître brut). Cohérent avec le commentaire déjà
 * présent dans claude-adapter.ts/mistral-adapter.ts : les noms de modèles
 * évoluent, donc centralisés ICI uniquement — à ajuster au même endroit
 * quand un provider publie un nouveau modèle recommandé.
 * - mistral : valeur déjà utilisée par onboarding-service.ts (reprise,
 *   pas une nouvelle invention).
 * - claude : "claude-sonnet-5", modèle Anthropic courant au moment de ce
 *   lot (31 août 2026).
 * - openai : "gpt-4o-mini" — ce provider n'est PAS activé par défaut en
 *   V1 (voir openai-adapter.ts), à revérifier contre platform.openai.com/docs/models
 *   avant toute activation réelle : le catalogue OpenAI change vite.
 */
export const DEFAULT_MODEL_BY_PROVIDER: Record<AIProviderName, string> = {
  mistral: "mistral-small-latest",
  claude: "claude-sonnet-5",
  openai: "gpt-4o-mini",
};

/**
 * MODIFIÉ Lot N : résout désormais le credential PAR TENANT (voir
 * secrets-resolver.ts::resolveCredential) plutôt que la seule clé
 * plateforme — un commerçant qui configure son propre compte IA
 * (`provider_connections`, provider_type='ai') l'utilise automatiquement
 * à partir de son prochain appel, sans changement ailleurs dans le code.
 */
async function buildAIAdapter(organizationId: string, providerName: string, model: string): Promise<AIProvider> {
  const apiKey = await resolveCredential(organizationId, "ai", providerName);
  switch (providerName) {
    case "mistral":
      return new MistralAdapter(apiKey, model);
    case "claude":
      return new ClaudeAdapter(apiKey, model);
    case "openai":
      return new OpenAIAdapter(apiKey, model);
    default:
      throw new Error(`AIProvider "${providerName}" non implémenté.`);
  }
}

export async function getAIProvider(organizationId: string): Promise<AIProviderBundle> {
  const supabase = getSupabaseServiceClient();

  const { data: config, error } = await supabase
    .from("ai_config")
    .select("provider, fallback_provider, model, enabled")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture ai_config: ${error.message}`);
  if (!config || !config.enabled) {
    throw new Error(`AI non activée pour l'organization ${organizationId} (voir ai_config.enabled).`);
  }

  const primary = await buildAIAdapter(organizationId, config.provider, config.model);
  // Lot L : le fallback doit utiliser un modèle DE SA PROPRE famille de
  // provider, pas `config.model` (celui du provider PRINCIPAL) — bug
  // latent pré-existant (jamais atteignable avant ce lot : aucune UI ne
  // permettait de configurer `fallback_provider` différent de `provider`
  // sans SQL direct). `/dashboard/ai` rend ce cas désormais courant, donc
  // corrigé ici plutôt que documenté comme une limitation.
  const fallback = config.fallback_provider
    ? await buildAIAdapter(
        organizationId,
        config.fallback_provider,
        DEFAULT_MODEL_BY_PROVIDER[config.fallback_provider as AIProviderName] ?? config.model,
      )
    : null;

  return { primary, fallback };
}

export async function getSocialPublishingProvider(organizationId: string): Promise<SocialPublishingProvider> {
  const supabase = getSupabaseServiceClient();

  const { data: connection, error } = await supabase
    .from("provider_connections")
    .select("provider_name, status")
    .eq("organization_id", organizationId)
    .eq("provider_type", "social")
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture provider_connections: ${error.message}`);
  if (!connection) {
    throw new Error(
      `Aucun SocialPublishingProvider connecté pour l'organization ${organizationId}. ` +
        `Connectez des comptes sociaux (Marketing → Paramètres) avant de publier.`,
    );
  }

  switch (connection.provider_name) {
    case "zernio": {
      const apiKey = await resolveCredential(organizationId, "social", "zernio");
      return new ZernioSocialAdapter(new ZernioSocialClient(apiKey));
    }
    default:
      throw new Error(`SocialPublishingProvider "${connection.provider_name}" non implémenté.`);
  }
}
