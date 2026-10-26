"use client";

import { useActionState } from "react";
import { saveAlertSettingsAction, type SettingsState } from "./actions";
import { ALERT_TRIGGERS, isTriggerEnabled, thresholdFor, type AlertSettings } from "@/application/alerts/alert-policy";

const UNIT = { XAF: "XAF", percent: "%", count: "" } as const;

export function AlertSettingsForm({ settings, members }: { settings: AlertSettings; members: { id: string; name: string; role: string }[] }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveAlertSettingsAction, {});
  const field = "adm-input";
  return (
    <form action={action} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="font-medium">Quand m&apos;alerter</legend>
        {ALERT_TRIGGERS.map((t) => (
          <div key={t.key} className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex min-w-60 items-center gap-2"><input type="checkbox" name={`enabled:${t.key}`} defaultChecked={isTriggerEnabled(settings, t.key)} />{t.label}{t.severity === "critical" && <span className="text-xs text-red-700">critique</span>}</label>
            {t.thresholdUnit && t.thresholdUnit !== "count" && (
              <label className="flex items-center gap-1 text-slate-600">dès <input className={`${field} w-28`} name={`threshold:${t.key}`} type="number" min="0" step="any" defaultValue={thresholdFor(settings, t.key) ?? ""} placeholder="aucun seuil" /> {UNIT[t.thresholdUnit]}</label>
            )}
          </div>
        ))}
        <p className="text-xs text-slate-500">« Dépense publicitaire » et « Client mécontent » ne produiront d&apos;alertes qu&apos;une fois les modules correspondants actifs.</p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-medium">Heures calmes</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="quietEnabled" defaultChecked={settings.quietEnabled} />Retenir les alertes non critiques pendant ces heures</label>
        <div className="flex items-center gap-2 text-sm">de <input className={field} type="time" name="quietStart" defaultValue={settings.quietStart} required /> à <input className={field} type="time" name="quietEnd" defaultValue={settings.quietEnd} required /></div>
        <p className="text-xs text-slate-500">Heure de votre entreprise. Les alertes critiques sonnent toujours.</p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-medium">Si je ne réponds pas</legend>
        <label className="block text-sm">Délai avant de relancer (minutes)<input className={`${field} ml-2 w-24`} type="number" name="escalationDelayMinutes" min="1" max="1440" defaultValue={settings.escalationDelayMinutes} required /></label>
        <label className="block text-sm">Personne de repli
          <select className={`${field} ml-2`} name="fallbackMembershipId" defaultValue={settings.fallbackMembershipId ?? ""}>
            <option value="">Aucune</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
          </select>
        </label>
        <p className="text-xs text-slate-500">Ordre : notification push, puis Telegram / WhatsApp / email, puis la personne de repli. Aucun appel téléphonique.</p>
      </fieldset>

      <button type="submit" className="adm-btn-primary px-4 py-2" disabled={pending}>Enregistrer</button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-green-700">Réglages enregistrés.</p>}
    </form>
  );
}
