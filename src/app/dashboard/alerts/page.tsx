import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { getAlertOverview } from "@/application/services/alert-service";
import { AlertSettingsForm } from "./settings-form";
import { acknowledgeAlertAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { held: "Retenue (heures calmes)", open: "En cours", acknowledged: "Prise en compte", expired: "Sans réponse" };
const CHANNEL: Record<string, string> = { push: "push", telegram: "Telegram", whatsapp: "WhatsApp", email: "email", in_app: "in-app" };

export default async function AlertsPage() {
  const actor = await requireDashboardActor();
  if (actor.role !== "owner" && actor.role !== "admin") {
    return <div className="mx-auto max-w-3xl"><p className="text-sm text-slate-600">Cet écran est réservé au propriétaire et aux administrateurs.</p></div>;
  }
  const overview = await getAlertOverview(actor.tenantId);
  const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Alertes</h1>
        <p className="text-sm text-slate-600">Choisissez ce qui doit vous réveiller, quand ne pas vous déranger, et qui prend le relais si vous ne répondez pas.</p>
      </header>
      <section className="adm-card p-5" aria-labelledby="al-settings"><h2 id="al-settings" className="sr-only">Réglages</h2><AlertSettingsForm settings={overview.settings} members={overview.members} /></section>
      <section className="adm-card space-y-3 p-5" aria-labelledby="al-history">
        <h2 id="al-history" className="font-medium">Dernières alertes</h2>
        {overview.recent.length === 0 ? <p className="text-sm text-slate-500">Aucune alerte pour l&apos;instant.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {overview.recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{a.title}</p>
                  <p className="text-xs text-slate-500">{fmt(a.createdAt)} · {STATUS[a.status] ?? a.status} · envoyé via {[...new Set(a.deliveries.filter((d) => d.status === "sent").map((d) => CHANNEL[d.channel] ?? d.channel))].join(", ") || "aucun canal"}</p>
                </div>
                {(a.status === "open" || a.status === "held") && <form action={acknowledgeAlertAction}><input type="hidden" name="alertId" value={a.id} /><button type="submit" className="adm-btn-secondary px-3 py-1.5">J&apos;ai vu</button></form>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
