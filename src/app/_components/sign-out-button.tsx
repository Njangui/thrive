"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/browser-client";

/**
 * Repasse sécurité P0 (07/09/2026, section 7 de la mission) : introduit
 * en corrigeant `/invite/accept` (un utilisateur connecté avec la
 * mauvaise adresse doit pouvoir se déconnecter pour réessayer avec la
 * bonne), mais aucune route de déconnexion n'existait NULLE PART dans
 * le projet avant ce composant (grep exhaustif sur `signOut`/`/logout` —
 * aucun résultat). Client component, même approche que `/login`
 * (`getSupabaseBrowserClient().auth.signInWithPassword/signUp` côté
 * navigateur plutôt qu'une Server Action) — cohérent avec le choix déjà
 * fait pour ce flux d'auth précis.
 */
export function SignOutButton({ className, redirectTo = "/login" }: { className?: string; redirectTo?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <button type="button" onClick={handleSignOut} disabled={pending} className={className}>
      {pending ? "Déconnexion…" : "Se déconnecter"}
    </button>
  );
}
