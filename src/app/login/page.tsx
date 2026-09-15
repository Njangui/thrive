"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/browser-client";

/**
 * Lot L — `next` (ex: `/invite/accept?token=...`) doit survivre
 * l'authentification (connexion OU inscription) : porté en query param
 * jusqu'à `emailRedirectTo` pour l'inscription (confirmation email),
 * relu par `/auth/callback` (voir route.ts) pour rediriger un utilisateur
 * SANS organisation vers l'invitation plutôt que vers /onboarding par
 * défaut.
 *
 * Email + mot de passe (signInWithPassword / signUp) plutôt que le lien
 * magique d'origine — le round-trip par email ne reste nécessaire QUE
 * pour la confirmation d'inscription (si activée côté Supabase) et la
 * réinitialisation de mot de passe, pas pour une connexion normale.
 *
 * Habillage repris en violet/navy (chantier d'unification design, sept.
 * 2026), même vocabulaire que l'ancienne version magic-link : carte
 * centrée + badge "S", `adm-input`/`adm-btn-primary`/`adm-alert-*`.
 */
function sanitizeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

type Mode = "signin" | "signup" | "forgot";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = sanitizeNext(searchParams.get("next"));

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function switchMode(newMode: Mode) {
    setMode(newMode);
    setStatus("idle");
    setErrorMessage(null);
  }

  function buildCallbackUrl(target: string) {
    const url = new URL("/auth/callback", window.location.origin);
    if (target) url.searchParams.set("next", target);
    return url.toString();
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus("error");
      setErrorMessage(
        error.message === "Invalid login credentials" ? "Email ou mot de passe incorrect." : error.message,
      );
      return;
    }

    router.push(next ?? "/dashboard");
    router.refresh();
  }

  async function handleSignUp(e: React.FormEvent) {
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
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: buildCallbackUrl(next ?? "") },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    if (data.session) {
      router.push(next ?? "/dashboard");
      router.refresh();
      return;
    }

    setStatus("sent");
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildCallbackUrl("/reset-password"),
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <p className="adm-alert-success">
        {mode === "forgot"
          ? `Email envoyé à ${email}. Suivez le lien pour choisir un nouveau mot de passe.`
          : `Compte créé. Vérifiez votre boîte de réception (${email}) pour confirmer votre email avant de vous connecter.`}
      </p>
    );
  }

  return (
    <>
      {next && mode !== "forgot" && (
        <p className="adm-alert-neutral">Connectez-vous pour accepter votre invitation.</p>
      )}

      <form
        onSubmit={mode === "signin" ? handleSignIn : mode === "signup" ? handleSignUp : handleForgotPassword}
        className="flex flex-col gap-3"
      >
        <input
          type="email"
          required
          placeholder="vous@entreprise.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="adm-input"
        />

        {mode !== "forgot" && (
          <input
            type="password"
            required
            minLength={6}
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="adm-input"
          />
        )}

        {mode === "signup" && (
          <input
            type="password"
            required
            minLength={6}
            placeholder="Confirmer le mot de passe"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="adm-input"
          />
        )}

        {mode === "signin" && (
          <button type="button" onClick={() => switchMode("forgot")} className="self-end text-xs adm-muted hover:text-violet-600">
            Mot de passe oublié ?
          </button>
        )}

        <button type="submit" disabled={status === "sending"} className="adm-btn-primary w-full">
          {status === "sending"
            ? "Envoi..."
            : mode === "signin"
              ? "Se connecter"
              : mode === "signup"
                ? "Créer mon compte"
                : "Envoyer le lien de réinitialisation"}
        </button>

        {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
      </form>

      <button type="button" onClick={() => switchMode(mode === "signin" ? "signup" : "signin")} className="text-center text-sm adm-muted hover:text-violet-600">
        {mode === "signin"
          ? "Pas encore de compte ? Créer un compte"
          : mode === "signup"
            ? "Déjà un compte ? Se connecter"
            : "Retour à la connexion"}
      </button>
    </>
  );
}

export default function LoginPage() {
  return (
    <main className="adm-shell flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 font-jakarta text-lg font-bold text-white">
            S
          </span>
          <div>
            <h1 className="font-jakarta text-2xl font-bold tracking-tight text-navy-900">Connexion</h1>
            <p className="mt-1 text-sm adm-muted">Accédez à votre espace avec votre email et votre mot de passe.</p>
          </div>
        </div>
        <div className="adm-card flex flex-col gap-4">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
