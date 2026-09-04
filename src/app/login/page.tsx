"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/browser-client";

/**
 * Lot L — `next` (ex: `/invite/accept?token=...`) doit survivre le
 * round-trip magic link : porté ici en query param jusqu'à
 * `emailRedirectTo`, relu par `/auth/callback` (voir route.ts) pour
 * rediriger un utilisateur SANS organisation vers l'invitation plutôt que
 * vers /onboarding par défaut — sinon un nouvel utilisateur invité se
 * retrouverait à créer sa PROPRE organisation au lieu de rejoindre celle
 * qui l'a invité.
 */
function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const supabase = getSupabaseBrowserClient();
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    if (next) callbackUrl.searchParams.set("next", next);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl.toString() },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <>
      {next && (
        <p className="rounded-brand border border-ink/10 bg-ink/5 px-4 py-3 text-sm text-muted">
          Connectez-vous pour accepter votre invitation.
        </p>
      )}

      {status === "sent" ? (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">
          Lien envoyé à {email}. Vérifiez votre boîte de réception.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="vous@entreprise.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-brand bg-leaf px-4 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status === "sending" ? "Envoi..." : "Recevoir le lien de connexion"}
          </button>
          {errorMessage && <p className="text-sm text-clay">{errorMessage}</p>}
        </form>
      )}
    </>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Connexion</h1>
        <p className="mt-1 text-sm text-muted">
          Pas de mot de passe — on vous envoie un lien de connexion par email.
        </p>
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
