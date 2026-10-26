"use client";

import { useActionState } from "react";
import { generateTelegramLinkAction, setPinAction, type LinkState, type PinState } from "./actions";

export function LinkTelegramCard({ botConfigured }: { botConfigured: boolean }) {
  const [state, action, pending] = useActionState<LinkState>(generateTelegramLinkAction, {});
  return (
    <div className="space-y-3">
      {!botConfigured && <p className="text-sm text-amber-700">Le bot Telegram n&apos;est pas configuré sur ce déploiement : le lien direct est indisponible, saisissez le code dans le bot.</p>}
      <form action={action}><button type="submit" className="adm-btn-primary px-4 py-2" disabled={pending}>{pending ? "Génération…" : "Générer un code"}</button></form>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.code && (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm">
          <p>Votre code (valable 10 minutes, usage unique) :</p>
          <p className="my-2 select-all font-mono text-2xl tracking-widest">{state.code}</p>
          {state.deepLink && <p><a className="adm-btn-secondary inline-block px-3 py-1.5" href={state.deepLink} target="_blank" rel="noopener noreferrer">Ouvrir Telegram</a></p>}
          <p className="mt-2 text-xs text-slate-600">Envoyez-le au bot en conversation privée : <span className="font-mono">/start {state.code}</span>. Ne le partagez avec personne.</p>
        </div>
      )}
    </div>
  );
}

export function PinForm({ hasPin }: { hasPin: boolean }) {
  const [state, action, pending] = useActionState<PinState, FormData>(setPinAction, {});
  const field = "adm-input w-full";
  return (
    <form action={action} className="max-w-sm space-y-3" autoComplete="off">
      {hasPin && <label className="block text-sm">PIN actuel<input className={field} name="currentPin" type="password" inputMode="numeric" pattern="\d{6,8}" maxLength={8} required autoComplete="off" /></label>}
      <label className="block text-sm">{hasPin ? "Nouveau PIN" : "PIN"} (6 à 8 chiffres)<input className={field} name="pin" type="password" inputMode="numeric" pattern="\d{6,8}" maxLength={8} required autoComplete="new-password" /></label>
      <label className="block text-sm">Confirmer le PIN<input className={field} name="pinConfirm" type="password" inputMode="numeric" pattern="\d{6,8}" maxLength={8} required autoComplete="new-password" /></label>
      <button type="submit" className="adm-btn-primary px-4 py-2" disabled={pending}>{hasPin ? "Changer le PIN" : "Définir le PIN"}</button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-green-700">PIN enregistré.</p>}
    </form>
  );
}
