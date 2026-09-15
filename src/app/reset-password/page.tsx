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
 *
 * Habillage aligné sur /login (chantier d'unification design, sept. 2026).
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
        className="adm-input"
      />
      <input
        type="password"
        required
        minLength={6}
        placeholder="Confirmer le nouveau mot de passe"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        className="adm-input"
      />
      <button type="submit" disabled={status === "sending"} className="adm-btn-primary w-full">
        {status === "sending" ? "Enregistrement..." : "Enregistrer le nouveau mot de passe"}
      </button>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="adm-shell flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 font-jakarta text-lg font-bold text-white">
            S
          </span>
          <div>
            <h1 className="font-jakarta text-2xl font-bold tracking-tight text-navy-900">Nouveau mot de passe</h1>
            <p className="mt-1 text-sm adm-muted">Choisissez un nouveau mot de passe pour votre compte.</p>
          </div>
        </div>
        <div className="adm-card flex flex-col gap-4">
          <Suspense fallback={null}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
