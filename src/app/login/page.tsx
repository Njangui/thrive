"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/browser-client";
import { AuthShell } from "@/app/_components/auth-shell";

function sanitizeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = sanitizeNext(searchParams.get("next"));
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function switchMode(newMode: "signin" | "forgot") {
    setMode(newMode); setStatus("idle"); setErrorMessage(null);
  }
  function buildCallbackUrl(target: string) {
    const url = new URL("/auth/callback", window.location.origin);
    if (target) url.searchParams.set("next", target);
    return url.toString();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setStatus("sending"); setErrorMessage(null);
    const supabase = getSupabaseBrowserClient();
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setStatus("error"); setErrorMessage(error.message === "Invalid login credentials" ? "Email ou mot de passe incorrect." : error.message); return; }
      router.push(next ?? "/dashboard"); router.refresh(); return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: buildCallbackUrl("/reset-password") });
    if (error) { setStatus("error"); setErrorMessage(error.message); return; }
    setStatus("sent");
  }

  return (
    <>
      {next && mode === "signin" && <p className="adm-alert-neutral">Connectez-vous pour continuer vers votre invitation.</p>}
      {status === "sent" ? (
        <div className="auth-success"><span>✓</span><div><strong>Email envoyé</strong><p>Si un compte existe pour {email}, vous recevrez un lien pour continuer.</p></div></div>
      ) : (
        <form onSubmit={submit} className="auth-form-stack">
          <label className="auth-field"><span>Email professionnel</span><input type="email" required autoComplete="email" placeholder="vous@entreprise.com" value={email} onChange={(e) => setEmail(e.target.value)} className="adm-input" /></label>
          {mode === "signin" && <label className="auth-field"><span>Mot de passe</span><input type="password" required minLength={6} autoComplete="current-password" placeholder="Votre mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} className="adm-input" /></label>}
          {mode === "signin" && <button type="button" onClick={() => switchMode("forgot")} className="auth-link-right">Mot de passe oublié ?</button>}
          <button type="submit" disabled={status === "sending"} className="adm-btn-primary auth-submit">{status === "sending" ? "Connexion..." : mode === "signin" ? "Se connecter" : "Envoyer le lien"}</button>
          {errorMessage && <p className="adm-alert-danger">{errorMessage}</p>}
        </form>
      )}
      <div className="auth-divider"><span>ou</span></div>
      <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="auth-secondary-button">Créer un compte gratuitement</Link>
      {mode === "forgot" && <button type="button" onClick={() => switchMode("signin")} className="auth-text-button">← Retour à la connexion</button>}
    </>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><AuthShell title="Se connecter" subtitle="Accédez à votre espace de travail et reprenez votre activité là où vous l’avez laissée."><LoginForm /></AuthShell></Suspense>;
}
