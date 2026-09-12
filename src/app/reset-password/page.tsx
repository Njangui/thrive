"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/browser-client";

/**
 * Atteinte uniquement via le lien envoyé par `resetPasswordForEmail`
 * (voir login/page.tsx, mode "forgot") : le round-trip passe par
 * `/auth/callback` (`next=/reset-password`), qui échange le code contre
 * une session AVANT d'arriver ici — `updateUser` ci-dessous s'appuie donc
 * sur cette session déjà active, jamais sur un jeton lu depuis l'URL.
 */
function sanitizeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = sanitizeNext(searchParams.get("next"));

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < 6) {
      setStatus("error");
      setErrorMessage("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (password !== confirmPassword) {
      setStatus("error");
      setErrorMessage("Les mots de passe ne correspondent pas.");
      return;
    }

    setStatus("sending");
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    router.push(next ?? "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="password"
        required
        minLength={6}
        placeholder="Nouveau mot de passe"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
      />
      <input
        type="password"
        required
        minLength={6}
        placeholder="Confirmer le nouveau mot de passe"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-brand bg-leaf px-4 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === "sending" ? "Enregistrement..." : "Enregistrer le nouveau mot de passe"}
      </button>
      {errorMessage && <p className="text-sm text-clay">{errorMessage}</p>}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Nouveau mot de passe</h1>
        <p className="mt-1 text-sm text-muted">Choisissez un nouveau mot de passe pour votre compte.</p>
      </div>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
