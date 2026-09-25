"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/browser-client";
import { AuthShell, GoogleIcon } from "@/app/_components/auth-shell";

function sanitizeNext(next: string | null): string | null { return next && next.startsWith("/") && !next.startsWith("//") ? next : null; }

function SignupForm() {
  const router = useRouter(); const params = useSearchParams(); const next = sanitizeNext(params.get("next"));
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false); const [message, setMessage] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false); const [oauthError, setOauthError] = useState<string | null>(null);
  function callbackUrl() { const url = new URL("/auth/callback", window.location.origin); if (next) url.searchParams.set("next", next); return url.toString(); }
  /** Même provider Google que /login — un compte Google inexistant est créé
   * automatiquement par Supabase au premier passage, "connexion" et
   * "inscription" sont donc la même action de ce côté (voir sa note). */
  async function signInWithGoogle() {
    setOauthError(null); setOauthPending(true);
    const { error: authError } = await getSupabaseBrowserClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl() } });
    if (authError) { setOauthPending(false); setOauthError(authError.message); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (password.length < 6) return setError("Le mot de passe doit contenir au moins 6 caractères.");
    if (password !== confirm) return setError("Les mots de passe ne correspondent pas.");
    setPending(true);
    const { data, error: authError } = await getSupabaseBrowserClient().auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl() } });
    if (authError) { setPending(false); setError(authError.message); return; }
    if (data.session) { router.push(next ?? "/onboarding"); router.refresh(); return; }
    setPending(false); setMessage(`Compte créé. Vérifiez votre boîte de réception (${email}) pour confirmer votre adresse.`);
  }
  return (
    <>
      {message ? <div className="auth-success"><span>✓</span><div><strong>Presque terminé</strong><p>{message}</p></div></div> : <>
        <button type="button" onClick={signInWithGoogle} disabled={oauthPending} className="auth-oauth-button">
          <GoogleIcon className="h-[18px] w-[18px]" />
          {oauthPending ? "Redirection..." : "Continuer avec Google"}
        </button>
        {oauthError && <p className="adm-alert-danger mt-3">{oauthError}</p>}
        <div className="auth-divider"><span>ou avec votre email</span></div>
        <form onSubmit={submit} className="auth-form-stack">
        <label className="auth-field"><span>Email professionnel</span><input type="email" required autoComplete="email" placeholder="vous@entreprise.com" value={email} onChange={e => setEmail(e.target.value)} className="adm-input" /></label>
        <label className="auth-field"><span>Mot de passe</span><input type="password" required minLength={6} autoComplete="new-password" placeholder="6 caractères minimum" value={password} onChange={e => setPassword(e.target.value)} className="adm-input" /></label>
        <label className="auth-field"><span>Confirmer le mot de passe</span><input type="password" required minLength={6} autoComplete="new-password" placeholder="Retapez votre mot de passe" value={confirm} onChange={e => setConfirm(e.target.value)} className="adm-input" /></label>
        <p className="auth-legal">En créant votre compte, vous acceptez nos conditions d’utilisation et notre politique de confidentialité.</p>
        <button type="submit" disabled={pending} className="adm-btn-primary auth-submit">{pending ? "Création..." : "Créer mon compte"}</button>
        {error && <p className="adm-alert-danger">{error}</p>}
        </form>
      </>}
      <div className="auth-divider"><span>déjà inscrit ?</span></div>
      <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="auth-secondary-button">Se connecter</Link>
    </>
  );
}
export default function SignupPage() { return <Suspense fallback={null}><AuthShell mode="signup" title="Créer votre compte" subtitle="Commencez par votre email. Ensuite, Flexco vous accompagne pour configurer votre entreprise."><SignupForm /></AuthShell></Suspense>; }
