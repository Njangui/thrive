/**
 * Résolution des credentials de provider.
 *
 * ⚠️ ÉTAT ACTUEL (Phase 2, MVP) : les credentials vivent dans les variables
 * d'environnement du serveur, une par provider (mono-tenant pour les clés
 * elles-mêmes). C'est volontairement simple pour un unique tenant pilote.
 *
 * AVANT d'onboarder plusieurs tenants avec des comptes Zernio/CinetPay
 * DIFFÉRENTS chacun, il faut remplacer ceci par une vraie résolution
 * per-tenant (Supabase Vault, ou un secret manager externe type AWS
 * Secrets Manager / Doppler), indexée par `provider_connections.credential_reference`.
 * Ne PAS committer de clés multi-tenant en variables d'environnement.
 */

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
