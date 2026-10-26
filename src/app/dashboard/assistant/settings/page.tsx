import Link from "next/link";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { getAgentKernel } from "@/application/agents/kernel";
import {
  buildSettingsView, canEditAssistantSettings, FIXED_GUARDRAILS, loadAssistantSettings, PROFILE_LABELS, toJournalEntry,
} from "@/application/agents/settings-service";
import { SupabaseAgentSettingsRepository } from "@/infrastructure/agents/supabase-agent-repositories";
import { listJournalRows } from "@/infrastructure/agents/journal-repository";
import { AssistantSettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

const TONE = { ok: "text-green-700", wait: "text-amber-700", stop: "text-red-700" } as const;

export default async function AssistantSettingsPage() {
  const actor = await requireDashboardActor();
  if (!canEditAssistantSettings(actor.role)) {
    return <div className="mx-auto max-w-3xl"><p className="text-sm text-slate-600">Cet écran est réservé au propriétaire et aux administrateurs.</p></div>;
  }
  const { kernel } = getAgentKernel();
  const tools = kernel.registry.list();
  const [settings, rows] = await Promise.all([loadAssistantSettings(new SupabaseAgentSettingsRepository(), actor.tenantId), listJournalRows(actor.tenantId)]);
  const labelOf = (name: string) => {
    const t = kernel.registry.get(name);
    return t ? (t.description.split(/(?<=\.)\s/)[0] ?? name).replace(/\.$/, "") : name;
  };
  const journal = rows.map((r) => toJournalEntry(r, labelOf)).filter((e): e is NonNullable<typeof e> => e !== null);
  const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const profiles = (Object.keys(PROFILE_LABELS) as (keyof typeof PROFILE_LABELS)[]).map((key) => ({ key, ...PROFILE_LABELS[key] }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm"><Link href="/dashboard/assistant" className="text-slate-600 underline">← Assistant de pilotage</Link></p>
        <h1 className="text-xl font-semibold">Réglages de l&apos;assistant</h1>
        <p className="text-sm text-slate-600">Choisissez ce que l&apos;assistant fait seul et ce qu&apos;il doit vous faire valider.</p>
      </header>
      <section className="adm-card p-5" aria-labelledby="as-settings"><h2 id="as-settings" className="sr-only">Réglages</h2><AssistantSettingsForm view={buildSettingsView(settings, tools)} profiles={profiles} /></section>
      <section className="adm-card space-y-2 p-5" aria-labelledby="as-guard">
        <h2 id="as-guard" className="font-medium">Toujours validé, quoi que vous choisissiez</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{FIXED_GUARDRAILS.map((g) => <li key={g}>{g}</li>)}</ul>
      </section>
      <section className="adm-card space-y-3 p-5" aria-labelledby="as-journal">
        <h2 id="as-journal" className="font-medium">Journal des actions</h2>
        {journal.length === 0 ? <p className="text-sm text-slate-500">Aucune action pour l&apos;instant.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {journal.map((e) => (
              <li key={e.id} className="py-2">
                <p className={TONE[e.tone]}>{e.label}</p>
                <p className="text-xs text-slate-500">{fmt(e.createdAt)} · via {e.channel}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
