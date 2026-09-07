"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Client navigateur — uniquement la clé anon (jamais service_role côté
 * client, section 35/54). RLS reste la seule barrière de sécurité réelle
 * ici ; ne jamais faire confiance à une vérification frontend seule.
 */
export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
