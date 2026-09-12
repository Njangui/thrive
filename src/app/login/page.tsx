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
 * défaut — sinon un nouvel utilisateur invité se retrouverait à créer sa
 * PROPRE organisation au lieu de rejoindre celle qui l'a invité.
 *
 * Remplace l'ancien flux "lien magique" (signInWithOtp) par email + mot
 * de passe (signInWithPassword / signUp). Le round-trip par email ne
 * reste nécessaire QUE pour la confirmation d'inscription (si activée
 * côté Supabase) et la réinitialisation de mot de passe — pas pour une
 * connexion normale, qui obtient sa session directement.
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
      // Confirmation email désactivée côté Supabase : session immédiate,
      // pas besoin d'attendre un email.
      router.push(next ?? "/dashboard");
      router.refresh();
      return;
    }

    // Confirmation email requise (réglage Supabase par défaut) : l'utilisateur
    // doit cliquer le lien reçu avant de pouvoir se connecter.
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
      <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">
        {mode === "forgot"
          ? `Email envoyé à ${email}. Suivez le lien pour choisir un nouveau mot de passe.`
          : `Compte créé. Vérifiez votre boîte de réception (${email}) pour confirmer votre email avant de vous connecter.`}
      </p>
    );
  }

  return (
    <>
      {next && mode !== "forgot" && (
        <p className="rounded-brand border border-ink/10 bg-ink/5 px-4 py-3 text-sm text-muted">
          Connectez-vous pour accepter votre invitation.
        </p>
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
          className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
        />

        {mode !== "forgot" && (
          <input
            type="password"
            required
            minLength={6}
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
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
            className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
          />
        )}

        {mode === "signin" && (
          <button
            type="button"
            onClick={() => switchMode("forgot")}
            className="self-end text-xs text-muted hover:text-leaf"
          >
            Mot de passe oublié ?
          </button>
        )}

        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-brand bg-leaf px-4 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === "sending"
            ? "Envoi..."
            : mode === "signin"
              ? "Se connecter"
              : mode === "signup"
                ? "Créer mon compte"
                : "Envoyer le lien de réinitialisation"}
        </button>

        {errorMessage && <p className="text-sm text-clay">{errorMessage}</p>}
      </form>

      <button
        type="button"
        onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
        className="text-center text-sm text-muted hover:text-leaf"
      >
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Connexion</h1>
        <p className="mt-1 text-sm text-muted">Accédez à votre espace avec votre email et votre mot de passe.</p>
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
