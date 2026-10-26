"use client";

import { useActionState } from "react";
import { generateWhatsAppLinkAction, refreshTemplatesAction, saveWhatsAppSettingsAction, submitTemplatesAction, type WaLinkState, type WaSettingsState, type WaTemplatesState } from "./actions";

export function LinkWhatsAppCard({ businessNumber }: { businessNumber: string | null }) {
  const [state, action, pending] = useActionState<WaLinkState>(generateWhatsAppLinkAction, {});
  return (
    <div className="space-y-3">
      <form action={action}><button type="submit" className="adm-btn-primary px-4 py-2" disabled={pending}>{pending ? "Génération…" : "Générer un code"}</button></form>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.code && (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm">
          <p>Depuis le WhatsApp à relier, envoyez ce message{businessNumber ? <> au <span className="font-medium">{businessNumber}</span></> : " au numéro WhatsApp de l'entreprise"} :</p>
          <p className="my-2 select-all font-mono text-xl tracking-wider">LIER {state.code}</p>
          <p className="text-xs text-slate-600">Valable 10 minutes, usage unique. C&apos;est l&apos;envoi depuis ce numéro qui prouve que vous en avez le contrôle : ne saisissez jamais le numéro à la main et ne partagez pas ce code.</p>
        </div>
      )}
    </div>
  );
}

export function SettingsForm({ enabled, dedicatedAccountId, numbers }: { enabled: boolean; dedicatedAccountId: string | null; numbers: { accountId: string; phone: string | null }[] }) {
  const [state, action, pending] = useActionState<WaSettingsState, FormData>(saveWhatsAppSettingsAction, {});
  return (
    <form action={action} className="max-w-xl space-y-3">
      <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" name="enabled" defaultChecked={enabled} /><span>Activer le pilotage par WhatsApp. Les messages des numéros du personnel reliés vont à l&apos;assistant de pilotage et <strong>plus à vos clients</strong> ; tous les autres numéros restent traités comme des clients.</span></label>
      <label className="block text-sm">Numéro réservé au pilotage (optionnel)
        <select className="adm-input ml-2" name="dedicatedAccountId" defaultValue={dedicatedAccountId ?? ""}>
          <option value="">Aucun — numéro partagé avec les clients</option>
          {numbers.map((n) => <option key={n.accountId} value={n.accountId}>{n.phone ?? n.accountId}</option>)}
        </select>
      </label>
      <p className="text-xs text-slate-500">Avec un numéro réservé, tout ce qui arrive dessus est du pilotage : un numéro non relié reçoit un refus et n&apos;atteint jamais votre assistant client.</p>
      <button type="submit" className="adm-btn-primary px-4 py-2" disabled={pending}>Enregistrer</button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-green-700">Réglages enregistrés.</p>}
    </form>
  );
}

export function TemplateButtons() {
  const [s1, submit, p1] = useActionState<WaTemplatesState>(submitTemplatesAction, {});
  const [s2, refresh, p2] = useActionState<WaTemplatesState>(refreshTemplatesAction, {});
  const state = s1.message || s1.error ? s1 : s2;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <form action={submit}><button type="submit" className="adm-btn-primary px-3 py-1.5 text-sm" disabled={p1}>Envoyer les modèles à Meta</button></form>
        <form action={refresh}><button type="submit" className="adm-btn-secondary px-3 py-1.5 text-sm" disabled={p2}>Actualiser les statuts</button></form>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.message && <p role="status" className="text-sm text-green-700">{state.message}</p>}
    </div>
  );
}
