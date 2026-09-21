import { createHmac, randomBytes } from "node:crypto";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { env } from "@/lib/env";
import { NotFoundError, QuotaExceededError } from "@/lib/errors";
import { canUseFeature } from "./entitlements-service";
import { YouTubeClient } from "@/infrastructure/providers/social/youtube/client";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"];
const STATE_TTL_MS = 10 * 60 * 1000;

function stateSecret() { return process.env.YOUTUBE_OAUTH_STATE_SECRET || process.env.CRON_SECRET || "development-youtube-state-secret"; }
function sign(value: string) { return createHmac("sha256", stateSecret()).update(value).digest("hex"); }
function makeState(organizationId: string) { const raw = `${organizationId}.${Date.now()}.${randomBytes(16).toString("hex")}`; return `${raw}.${sign(raw)}`; }
function readState(state: string) {
  const parts = state.split(".");
  if (parts.length !== 4) throw new Error("État de connexion YouTube invalide.");
  const [organizationId, timestamp, nonce, signature] = parts;
  const raw = `${organizationId}.${timestamp}.${nonce}`;
  if (sign(raw) !== signature || Date.now() - Number(timestamp) > STATE_TTL_MS) throw new Error("La demande de connexion YouTube a expiré. Recommencez.");
  return organizationId as string;
}

function googleConfig() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("La connexion YouTube n'est pas encore activée sur cette plateforme.");
  return { clientId, clientSecret };
}

export function createYouTubeConnectUrl(organizationId: string) {
  const { clientId } = googleConfig();
  const state = makeState(organizationId);
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/youtube/callback`;
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: SCOPES.join(" "), state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function completeYouTubeOAuth(code: string, state: string) {
  const organizationId = readState(state);
  const { clientId, clientSecret } = googleConfig();
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/youtube/callback`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
  const tokens = (await tokenResponse.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!tokenResponse.ok || !tokens.access_token) throw new Error(`Connexion YouTube refusée (${tokens.error ?? tokenResponse.status}).`);
  if (!tokens.refresh_token) throw new Error("Google n'a pas fourni de jeton de renouvellement. Reconnectez le compte en autorisant l'accès hors ligne.");

  const youtube = new YouTubeClient({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000 });
  const channel = await youtube.getMine();
  const supabase = getSupabaseServiceClient();

  // Lot O — plusieurs chaînes par organisation. Reconnecter une chaîne déjà
  // enregistrée ne consomme pas de quota ; une NOUVELLE chaîne est refusée
  // avant tout stockage de jeton si l'offre est atteinte.
  const { data: existing, error: existingError } = await supabase
    .from("youtube_accounts")
    .select("id, credential_reference")
    .eq("organization_id", organizationId)
    .eq("channel_id", channel.id)
    .maybeSingle();
  if (existingError) throw new Error(`Lecture des chaînes YouTube impossible : ${existingError.message}`);
  if (!existing) {
    const entitlement = await canUseFeature(organizationId, "youtube_accounts", 1);
    if (!entitlement.allowed) {
      throw new QuotaExceededError(`La limite de chaînes YouTube de votre offre est atteinte (${entitlement.limit}).`);
    }
  }

  const secret = JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000 });
  const { data: secretId, error: secretError } = await supabase.rpc("vault_create_secret", { secret_value: secret, secret_name: `youtube:${organizationId}:${channel.id}:${Date.now()}` });
  if (secretError || !secretId) throw new Error(`Impossible de sécuriser la connexion YouTube : ${secretError?.message ?? "secret absent"}`);

  const { error } = await supabase.from("youtube_accounts").upsert(
    {
      organization_id: organizationId,
      channel_id: channel.id,
      title: channel.title,
      username: channel.customUrl ?? channel.title,
      credential_reference: secretId,
      status: "connected",
      connected_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,channel_id" },
  );
  if (error) {
    await supabase.rpc("vault_delete_secret", { secret_id: secretId });
    throw new Error(`Impossible d'enregistrer la connexion YouTube : ${error.message}`);
  }
  // Reconnexion : l'ancien secret est remplacé, jamais laissé orphelin dans Vault.
  if (existing?.credential_reference) {
    await supabase.rpc("vault_delete_secret", { secret_id: existing.credential_reference }).then(undefined, () => undefined);
  }
  return channel;
}

export interface YouTubeAccountSummary {
  id: string;
  channelId: string;
  title: string | null;
  username: string | null;
  connectedAt: string;
}

export async function listYouTubeAccounts(organizationId: string): Promise<YouTubeAccountSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("youtube_accounts")
    .select("id, channel_id, title, username, connected_at")
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .order("connected_at", { ascending: true });
  if (error) throw new Error(`Erreur lecture des chaînes YouTube : ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id as string, channelId: row.channel_id as string, title: row.title as string | null, username: row.username as string | null, connectedAt: row.connected_at as string }));
}

/** Déconnecte UNE chaîne : jeton supprimé de Vault, ligne conservée (historique des publications) au statut `disconnected`. */
export async function disconnectYouTubeAccount(organizationId: string, accountRowId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("youtube_accounts")
    .select("id, credential_reference")
    .eq("id", accountRowId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`Lecture de la chaîne YouTube impossible : ${error.message}`);
  if (!data) throw new NotFoundError("Chaîne YouTube introuvable.");
  if (data.credential_reference) {
    await supabase.rpc("vault_delete_secret", { secret_id: data.credential_reference }).then(undefined, () => undefined);
  }
  const { error: updateError } = await supabase.from("youtube_accounts").update({ status: "disconnected", credential_reference: null }).eq("id", accountRowId).eq("organization_id", organizationId);
  if (updateError) throw new Error(`Déconnexion YouTube impossible : ${updateError.message}`);
}

/** Compatibilité : première chaîne connectée (anciens appelants mono-compte). */
export async function getYouTubeConnection(organizationId: string) {
  const accounts = await listYouTubeAccounts(organizationId);
  const first = accounts[0];
  return { connected: Boolean(first), metadata: { channelId: first?.channelId, title: first?.title ?? undefined, username: first?.username ?? undefined } as { channelId?: string; title?: string; username?: string }, credentialReference: null as string | null };
}
