import Link from "next/link";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { getBackofficeSettingsView } from "@/application/services/whatsapp-backoffice-service";
import { getTemplateStatuses } from "@/application/services/whatsapp-template-service";
import { getChannelDiagnostics } from "@/application/services/whatsapp-channel-health-service";
import { LinkWhatsAppCard, SettingsForm, TemplateButtons } from "./forms";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  NOT_SUBMITTED: "Pas encore envoyé", PENDING: "En revue chez Meta", APPROVED: "Approuvé", REJECTED: "Refusé", IN_APPEAL: "En appel",
  PAUSED: "Suspendu", DISABLED: "Désactivé", PENDING_DELETION: "Suppression en cours",
};

export default async function WhatsAppBackofficePage() {
  const actor = await requireDashboardActor();
  const admin = actor.role === "owner" || actor.role === "admin";
  const [view, templates, issues] = await Promise.all([
    getBackofficeSettingsView(actor.tenantId),
    admin ? getTemplateStatuses(actor.tenantId) : Promise.resolve([]),
    admin ? getChannelDiagnostics(actor.tenantId) : Promise.resolve([]),
  ]);
  const primary = view.numbers.find((n) => n.isPrimary) ?? view.numbers[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm"><Link href="/dashboard/security" className="underline underline-offset-2">← Sécurité</Link></p>
        <h1 className="text-xl font-semibold">Pilotage par WhatsApp</h1>
        <p className="text-sm text-slate-600">Pilotez l&apos;entreprise depuis votre WhatsApp. Pour votre sécurité, les actions sensibles (remboursement, prix…) se valident toujours depuis le tableau de bord.</p>
      </header>

      {!admin ? null : (
        <section className="adm-card space-y-3 p-5" aria-labelledby="wa-settings">
          <h2 id="wa-settings" className="font-medium">Réglages</h2>
          {view.numbers.length === 0 && <p className="text-sm text-amber-700">Aucun numéro WhatsApp connecté. Connectez-le dans <Link href="/dashboard/channels" className="underline">Canaux</Link>.</p>}
          <SettingsForm enabled={view.enabled} dedicatedAccountId={view.dedicatedAccountId} numbers={view.numbers} />
        </section>
      )}

      <section className="adm-card space-y-3 p-5" aria-labelledby="wa-link">
        <h2 id="wa-link" className="font-medium">Relier mon WhatsApp</h2>
        {!view.enabled && !view.dedicatedAccountId && <p className="text-sm text-slate-600">Le pilotage par WhatsApp n&apos;est pas encore activé pour cette entreprise{admin ? " (voir Réglages)" : " : demandez au propriétaire de l'activer"}.</p>}
        <LinkWhatsAppCard businessNumber={primary?.phone ?? null} />
        <p className="text-xs text-slate-500">Vos numéros reliés apparaissent dans « Appareils reliés » de la page <Link href="/dashboard/security" className="underline">Sécurité</Link>, où vous pouvez les délier.</p>
      </section>

      {admin && (
        <section className="adm-card space-y-3 p-5" aria-labelledby="wa-templates">
          <h2 id="wa-templates" className="font-medium">Messages automatiques hors des 24 h</h2>
          <p className="text-sm text-slate-600">WhatsApp n&apos;autorise un message proactif (alerte, bilan, demande de validation) hors des 24 h suivant votre dernier message que par un modèle approuvé par Meta. Le texte de ces modèles est fixe ; seules les informations de l&apos;alerte s&apos;y ajoutent à l&apos;envoi.</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {templates.map((t) => (
              <li key={t.key} className="flex items-center gap-3 py-2">
                <span className="flex-1">{t.label}</span>
                <span className={t.status === "APPROVED" ? "text-green-700" : t.status === "REJECTED" || t.status === "PAUSED" || t.status === "DISABLED" ? "text-red-700" : "text-slate-600"}>{STATUS_LABEL[t.status] ?? t.status}</span>
                {t.reason && <span className="max-w-48 truncate text-xs text-slate-500" title={t.reason}>{t.reason}</span>}
              </li>
            ))}
          </ul>
          <TemplateButtons />
        </section>
      )}

      {admin && issues.length > 0 && (
        <section className="adm-card space-y-2 p-5" aria-labelledby="wa-diag">
          <h2 id="wa-diag" className="font-medium">Diagnostic du canal</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">{issues.map((i) => <li key={i.code} className={i.severity === "error" ? "text-red-800" : "text-amber-800"}>{i.message}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
