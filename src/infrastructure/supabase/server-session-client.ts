import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Client Supabase "session utilisateur" basé sur les cookies — le chaînon
 * manquant jusqu'ici : `server-client.ts` n'expose que le service-role
 * (webhooks/jobs) et un client scopé par bearer token brut. Toute route
 * authentifiée (dashboard admin, import CSV, etc.) doit passer par CELUI-CI,
 * pas par le service-role, pour que RLS s'applique réellement (section 35).
 */
export async function getSupabaseServerSessionClient() {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Appelé depuis un Server Component pur (pas un Route Handler /
          // Server Action) : l'écriture de cookie est refusée par Next.js,
          // c'est attendu — le middleware se charge du refresh de session
          // dans ce cas (voir doc officielle Supabase SSR).
        }
      },
    },
  });
}
