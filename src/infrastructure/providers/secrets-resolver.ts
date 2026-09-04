/**
 * Résolution des credentials de provider.
 *
 * `resolveProviderCredential` (ci-dessous) : clé plateforme mono-tenant,
 * une par provider, lue depuis les variables d'environnement du serveur.
 * Reste la source de vérité pour les providers qui n'ont, par nature,
 * qu'un seul compte plateforme (paiement d'abonnement NotchPay, stockage
 * Supabase) — jamais un compte par tenant.
 *
 * `resolveCredential` (Lot N, Partie 3) : résolution PAR TENANT pour les
 * providers où un commerçant peut avoir son propre compte dédié (Zernio,
 * un provider IA) — cherche d'abord un `credential_reference` dans
 * `provider_connections` (table déjà existante depuis 0005, voir
 * commentaire de 0037_tenant_credentials.sql), retombe sur la clé
 * plateforme en son absence. AUCUNE clé n'est jamais stockée en clair :
 * `credential_reference` est un id Supabase Vault, jamais le secret
 * lui-même.
 */

import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

const ENV_KEY_BY_PROVIDER: Record<string, string> = {
  zernio: "ZERNIO_API_KEY",
  mistral: "MISTRAL_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  cinetpay: "CINETPAY_API_KEY",
  notchpay: "NOTCHPAY_API_KEY",
};

export function resolveProviderCredential(providerName: string): string {
  const envKey = ENV_KEY_BY_PROVIDER[providerName];
  const value = envKey ? process.env[envKey] : undefined;
  if (!value) {
    throw new Error(
      `Aucun credential trouvé pour le provider "${providerName}". ` +
        `Vérifiez provider_connections et la variable d'environnement ${envKey ?? "(inconnue)"}.`,
    );
  }
  return value;
}

export type TenantCredentialProviderType = "messaging" | "social" | "ai";

/**
 * Résout le credential d'un (organizationId, providerType, providerName)
 * — repli automatique et silencieux vers la clé plateforme SI aucun
 * compte dédié n'a jamais été configuré (comportement inchangé pour tous
 * les tenants existants). En revanche, si un `credential_reference` EST
 * configuré mais que sa lecture Vault échoue, cette fonction LÈVE plutôt
 * que de retomber sur la clé plateforme — un repli silencieux dans ce
 * cas précis risquerait de faire transiter les données de ce tenant par
 * le mauvais compte (risque d'isolation, pas un simple inconvénient).
 */
export async function resolveCredential(
  organizationId: string,
  providerType: TenantCredentialProviderType,
  providerName: string,
): Promise<string> {
  const supabase = getSupabaseServiceClient();

  const { data: connection, error } = await supabase
    .from("provider_connections")
    .select("credential_reference")
    .eq("organization_id", organizationId)
    .eq("provider_type", providerType)
    .eq("provider_name", providerName)
    .maybeSingle();

  if (error) {
    console.error(
      `resolveCredential(${organizationId}, ${providerType}, ${providerName}): erreur lecture provider_connections, repli plateforme:`,
      error.message,
    );
    return resolveProviderCredential(providerName);
  }

  if (!connection?.credential_reference) {
    return resolveProviderCredential(providerName);
  }

  const { data: secret, error: vaultError } = await supabase.rpc("vault_read_secret", {
    secret_id: connection.credential_reference,
  });

  if (vaultError || !secret) {
    throw new Error(
      `resolveCredential(${organizationId}, ${providerType}, ${providerName}): compte dédié configuré mais secret ` +
        `introuvable (${vaultError?.message ?? "vide"}) — jamais de repli silencieux vers la clé plateforme ici.`,
    );
  }

  return secret as string;
}
