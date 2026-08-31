import type { AIProvider } from "@/domain/ports/ai-provider";
import type { MessagingProvider } from "@/domain/ports/messaging-provider";
import type { SocialPublishingProvider } from "@/domain/ports/social-publishing-provider";
import type { StorageProvider } from "@/domain/ports/storage-provider";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ZernioAdapter } from "./messaging/zernio/adapter";
import { ZernioClient } from "./messaging/zernio/client";
import { ZernioSocialAdapter } from "./social/zernio/adapter";
import { ZernioSocialClient } from "./social/zernio/client";
import { MistralAdapter } from "./ai/mistral-adapter";
import { ClaudeAdapter } from "./ai/claude-adapter";
import { OpenAIAdapter } from "./ai/openai-adapter";
import { SupabaseStorageAdapter } from "./storage/supabase-storage-adapter";
import { resolveProviderCredential } from "./secrets-resolver";

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
      const apiKey = resolveProviderCredential("zernio");
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

function buildAIAdapter(providerName: string, model: string): AIProvider {
  const apiKey = resolveProviderCredential(providerName);
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

  const primary = buildAIAdapter(config.provider, config.model);
  const fallback = config.fallback_provider
    ? buildAIAdapter(config.fallback_provider, config.model)
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
      const apiKey = resolveProviderCredential("zernio");
      return new ZernioSocialAdapter(new ZernioSocialClient(apiKey));
    }
    default:
      throw new Error(`SocialPublishingProvider "${connection.provider_name}" non implémenté.`);
  }
}
