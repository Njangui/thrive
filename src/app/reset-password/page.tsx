"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/browser-client";
import { AuthShell } from "@/app/_components/auth-shell";

function ResetForm() {
  const router = useRouter(); const params = useSearchParams(); const next = params.get("next")?.startsWith("/") && !params.get("next")?.startsWith("//") ? params.get("next") : null;
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) { e.preventDefault(); setError(null); if (password.length < 6) return setError("Le mot de passe doit contenir au moins 6 caractères."); if (password !== confirm) return setError("Les mots de passe ne correspondent pas."); setPending(true); const { error } = await getSupabaseBrowserClient().auth.updateUser({ password }); if (error) { setPending(false); setError(error.message); return; } setDone(true); setPending(false); }
  if (done) return <div className="auth-success"><span>✓</span><div><strong>Mot de passe mis à jour</strong><p>Votre compte est sécurisé. Vous pouvez maintenant accéder à votre espace.</p><Link href={next ?? "/dashboard"} className="auth-inline-link">Continuer →</Link></div></div>;
  return <form onSubmit={submit} className="auth-form-stack"><label className="auth-field"><span>Nouveau mot de passe</span><input type="password" required minLength={6} autoComplete="new-password" placeholder="6 caractères minimum" value={password} onChange={e => setPassword(e.target.value)} className="adm-input" /></label><label className="auth-field"><span>Confirmer le nouveau mot de passe</span><input type="password" required minLength={6} autoComplete="new-password" placeholder="Retapez votre mot de passe" value={confirm} onChange={e => setConfirm(e.target.value)} className="adm-input" /></label><div className="auth-password-rules"><span>✓ 6 caractères minimum</span><span>✓ Les deux mots de passe doivent correspondre</span></div><button type="submit" disabled={pending} className="adm-btn-primary auth-submit">{pending ? "Mise à jour..." : "Enregistrer le nouveau mot de passe"}</button>{error && <p className="adm-alert-danger">{error}</p>}</form>;
}
export default function ResetPasswordPage() { return <Suspense fallback={null}><AuthShell mode="reset" title="Réinitialiser votre mot de passe" subtitle="Choisissez un nouveau mot de passe pour retrouver votre espace SME-OS."><ResetForm /></AuthShell></Suspense>; }
