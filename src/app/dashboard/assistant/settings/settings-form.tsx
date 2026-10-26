"use client";

import { useActionState } from "react";
import { saveAssistantSettingsAction, type SettingsState } from "./actions";
import type { AssistantSettingsView } from "@/application/agents/settings-service";

type Props = {
  view: AssistantSettingsView;
  profiles: { key: string; label: string; help: string }[];
};

export function AssistantSettingsForm({ view, profiles }: Props) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveAssistantSettingsAction, {});
  const field = "adm-input";
  const domains = [...new Set(view.rows.map((r) => r.domain))];
  return (
    <form action={action} className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="font-medium">Niveau d&apos;autonomie</legend>
        {view.profile === "custom" && <p className="text-xs text-amber-700">Vos anciens réglages sont conservés tant que vous n&apos;enregistrez pas. Choisissez un profil pour les remplacer.</p>}
        {profiles.map((p) => (
          <label key={p.key} className="flex items-start gap-2 text-sm">
            <input type="radio" name="profile" value={p.key} defaultChecked={view.profile === p.key} required className="mt-1" />
            <span><span className="font-medium">{p.label}</span><span className="block text-slate-600">{p.help}</span></span>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-medium">Exceptions par action</legend>
        <p className="text-xs text-slate-500">« Suivre le profil » convient à la plupart des cas. Une action « Interdite » n&apos;est plus proposée à l&apos;assistant.</p>
        {domains.map((d) => (
          <div key={d} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{d}</h3>
            {view.rows.filter((r) => r.domain === d).map((r) => (
              <div key={r.tool} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="min-w-60 flex-1">{r.label}{r.risk === "sensitive" ? <span className="ml-2 text-xs text-red-700">sensible : validation + PIN</span> : r.alwaysAsk && <span className="ml-2 text-xs text-red-700">toujours validé</span>}</span>
                <select className={field} name={`mode:${r.tool}`} defaultValue={r.mode} aria-label={`Mode pour ${r.label}`}>
                  <option value="">Suivre le profil</option>
                  <option value="confirm">Toujours demander</option>
                  {!r.alwaysAsk && <option value="auto">Automatique</option>}
                  <option value="deny">Interdit</option>
                </select>
                {!r.alwaysAsk && (
                  <label className="flex items-center gap-1 text-slate-600">jusqu&apos;à
                    <input className={`${field} w-28`} name={`max:${r.tool}`} type="number" min="0" step="any" defaultValue={r.autoMaxAmount ?? ""} placeholder="profil" />
                  </label>
                )}
              </div>
            ))}
          </div>
        ))}
      </fieldset>

      <button type="submit" className="adm-btn-primary px-4 py-2" disabled={pending}>Enregistrer</button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-green-700">Réglages enregistrés.</p>}
    </form>
  );
}
