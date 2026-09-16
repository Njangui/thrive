import { createHmac, randomBytes } from "node:crypto";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { env } from "@/lib/env";
import { YouTubeClient, type YouTubeOAuthTokens } from "@/infrastructure/providers/social/youtube/client";

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
  return organizationId;
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
  const secret = JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000 });
  const { data: secretId, error: secretError } = await supabase.rpc("vault_create_secret", { secret_value: secret, secret_name: `youtube:${organizationId}` });
  if (secretError || !secretId) throw new Error(`Impossible de sécuriser la connexion YouTube : ${secretError?.message ?? "secret absent"}`);

  const { error } = await supabase.from("provider_connections").upsert({ organization_id: organizationId, provider_type: "social", provider_name: "youtube", status: "connected", credential_reference: secretId, metadata: { channelId: channel.id, title: channel.title, username: channel.customUrl ?? channel.title } }, { onConflict: "organization_id,provider_type,provider_name" });
  if (error) throw new Error(`Impossible d'enregistrer la connexion YouTube : ${error.message}`);
  return channel;
}

export async function getYouTubeConnection(organizationId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("provider_connections").select("status, metadata, credential_reference").eq("organization_id", organizationId).eq("provider_type", "social").eq("provider_name", "youtube").maybeSingle();
  if (error) throw new Error(`Erreur lecture connexion YouTube : ${error.message}`);
  return { connected: data?.status === "connected", metadata: (data?.metadata ?? {}) as { channelId?: string; title?: string; username?: string }, credentialReference: data?.credential_reference ?? null };
}
