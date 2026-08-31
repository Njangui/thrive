import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Client "service role" — bypass RLS. Réservé aux :
 *  - webhook handlers (le provider externe n'a pas de session utilisateur)
 *  - jobs serveur (automation engine, seed, cron)
 *
 * RÈGLE D'OR (section 35) : tout code utilisant ce client DOIT filtrer
 * explicitement par organization_id lui-même, puisque RLS ne le protège
 * plus. Ne jamais exposer ce client au frontend.
 */
let serviceClient: SupabaseClient | null = null;

export function getSupabaseServiceClient(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceClient;
}

/**
 * Client "scopé utilisateur" — respecte RLS via le JWT de la requête.
 * À utiliser dans les Server Actions / Route Handlers appelés depuis le
 * dashboard, jamais pour des webhooks.
 */
export function getSupabaseUserClient(accessToken: string): SupabaseClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
