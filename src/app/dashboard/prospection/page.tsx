import { notFound, redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { isPlatformTenant } from "@/application/services/platform-tenant";
import { PROSPECTING_TEMPLATES } from "@/application/services/prospecting-core";
import {
  approveCampaign, createCampaignFromCsv, defaultProspectingDeps, ensureProspectingTemplates, listCampaignsWithCounts, previewCampaign, setCampaignStatus,
} from "@/application/services/prospecting-service";
import { AppError, AuthorizationError, ValidationError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";
import { ConfirmSubmitButton } from "../site/versions/confirm-submit-button";

/**
 * Prospection WhatsApp (entreprise Flexco uniquement). Rien ne part sans validation : on importe une liste, on lit
 * l'aperçu exact du message, on déclare la base de contact des numéros, puis on valide. L'envoi est ensuite automatique
 * (plafond quotidien, plage horaire, STOP, 1 relance).
 */
const BASE = "/dashboard/prospection";
const INPUT = "w-full rounded-xl border border-navy-900/10 px-4 py-3 text-sm outline-hidden focus:border-violet-400";
const STATUS_LABELS: Record<string, string> = { draft: "Brouillon", approved: "Validée", running: "En cours", paused: "Suspendue", completed: "Terminée", cancelled: "Annulée" };
const COUNT_LABELS: Record<string, string> = { queued: "En file", contacted: "Contactés", followed_up: "Relancés", replied: "Ont répondu", interested: "Intéressés", not_interested: "Refus", opted_out: "Désinscrits", failed: "Échecs", converted: "Convertis" };

async function perform(formData: FormData, work: (organizationId: string, userId: string) => Promise<string | { message: string; query: string }>, back = BASE): Promise<never> {
  const organizationId = String(formData.get("organizationId") ?? "");
  let message: string;
  let query = "";
  try {
    if (!isPlatformTenant(organizationId)) throw new AuthorizationError("La prospection est réservée à l'entreprise Flexco.");
    const membership = await requireMembership(organizationId);
    if (membership.role !== "owner" && membership.role !== "admin") throw new AuthorizationError("Réservé au propriétaire et aux administrateurs.");
    const out = await work(organizationId, membership.userId);
    message = typeof out === "string" ? out : out.message;
    query = typeof out === "string" ? "" : out.query;
  } catch (error) {
    if (!(error instanceof AppError)) console.error("Prospection: erreur inattendue:", error);
    redirect(`${back}?error=${encodeURIComponent(error instanceof AppError ? error.message : "Une erreur est survenue. Réessayez.")}`);
  }
  redirect(`${back}?${query}success=${encodeURIComponent(message)}`);
}
const text = (f: FormData, n: string) => String(f.get(n) ?? "").trim();

async function createAction(formData: FormData) {
  "use server";
  await perform(formData, async (org, userId) => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choisissez un fichier CSV (Excel : Enregistrer sous → CSV UTF-8).");
    if (file.size > 1_000_000) throw new ValidationError("Fichier trop volumineux (1 Mo maximum).");
    const s = await createCampaignFromCsv(org, userId, {
      name: text(formData, "name"), csv: await file.text(), dailyCap: Number(text(formData, "dailyCap") || 20),
      windowStartHour: Number(text(formData, "start") || 9), windowEndHour: Number(text(formData, "end") || 18),
    }, defaultProspectingDeps());
    return { query: `campaign=${s.campaignId}&`, message: `${s.imported} numéro(s) importé(s), ${s.invalid} invalide(s), ${s.duplicates} doublon(s), ${s.optedOut} déjà désinscrit(s). Relisez l'aperçu avant de valider.` };
  });
}
async function approveAction(formData: FormData) {
  "use server";
  await perform(formData, async (org, userId) => {
    await approveCampaign(org, userId, text(formData, "campaignId"), { fingerprint: text(formData, "fingerprint"), consentBasis: text(formData, "consentBasis") }, defaultProspectingDeps());
    return "Campagne validée. Les envois démarrent au prochain passage automatique, dans le plafond et la plage horaire.";
  });
}
async function statusAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const action = text(formData, "action");
    if (action !== "pause" && action !== "resume" && action !== "cancel") throw new ValidationError("Action inconnue.");
    const status = await setCampaignStatus(org, text(formData, "campaignId"), action, defaultProspectingDeps());
    return `Campagne : ${STATUS_LABELS[status] ?? status}.`;
  });
}
async function templatesAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const r = await ensureProspectingTemplates(org, defaultProspectingDeps());
    if (!r.ok) throw new ValidationError("Aucun numéro WhatsApp connecté : connectez-le d'abord.");
    return r.failed.length ? `Soumission partielle : ${r.failed.map((f) => f.message).join(" ; ")}` : r.submitted.length ? "Modèles envoyés à Meta pour revue (réponse sous quelques heures en général)." : "Modèles déjà soumis.";
  });
}

export default async function ProspectionPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string; campaign?: string }> }) {
  const { error, success, campaign } = await searchParams;
  const { organizationId, role } = await requireCurrentOrganization();
  if (!isPlatformTenant(organizationId)) notFound();
  if (role !== "owner" && role !== "admin") notFound();
  const deps = defaultProspectingDeps();
  const [campaigns, templates, preview] = await Promise.all([
    listCampaignsWithCounts(organizationId, deps),
    deps.store.templateStatuses(organizationId),
    campaign ? previewCampaign(organizationId, campaign, deps).catch(() => null) : Promise.resolve(null),
  ]);
  const idInput = <input type="hidden" name="organizationId" value={organizationId} />;
  const templatesReady = templates.intro === "APPROVED";

  return (
    <div className="flexco-page flex flex-col gap-4">
      <div>
        <p className="flexco-eyebrow">Croissance</p>
        <h1 className="mt-1 font-jakarta text-2xl font-extrabold tracking-tight sm:text-3xl">Prospection WhatsApp</h1>
        <p className="mt-1 text-sm text-slate-500">Importez une liste, lisez l&apos;aperçu exact, validez : l&apos;envoi est ensuite automatique et encadré (plafond, horaires, STOP, une seule relance).</p>
      </div>
      {error && <p className="adm-alert-danger">{error}</p>}
      {success && <p className="adm-alert-success">{success}</p>}

      <section className="flexco-info-panel">
        <h2 className="font-semibold text-navy-900">1. Modèles WhatsApp (Meta)</h2>
        <ul className="mt-2 text-sm text-slate-600">
          {PROSPECTING_TEMPLATES.map((t) => <li key={t.key}>{t.label} : <b>{templates[t.key] ?? "NON SOUMIS"}</b></li>)}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Un premier message à un numéro qui ne vous a pas écrit exige un modèle approuvé par Meta. Tant qu&apos;il ne l&apos;est pas, rien ne part.</p>
        <form action={templatesAction} className="mt-3">{idInput}<ConfirmSubmitButton message="Envoyer les deux modèles de prospection à Meta pour revue ?">Soumettre les modèles</ConfirmSubmitButton></form>
      </section>

      <section className="flexco-info-panel">
        <h2 className="font-semibold text-navy-900">2. Importer une liste</h2>
        <p className="mt-1 text-xs text-slate-500">Fichier CSV (depuis Excel : Enregistrer sous → CSV UTF-8). Colonnes reconnues : nom, téléphone (obligatoire), entreprise, secteur, ville, email ; les autres sont conservées.</p>
        <form action={createAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          {idInput}
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">Nom de la campagne<input name="name" required maxLength={120} className={`${INPUT} mt-1`} /></label>
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">Fichier<input type="file" name="file" accept=".csv,text/csv" required className={`${INPUT} mt-1`} /></label>
          <label className="text-xs font-medium text-slate-600">Messages par jour (1 à 200)<input name="dailyCap" type="number" min={1} max={200} defaultValue={20} className={`${INPUT} mt-1`} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-medium text-slate-600">Dès (h)<input name="start" type="number" min={0} max={23} defaultValue={9} className={`${INPUT} mt-1`} /></label>
            <label className="text-xs font-medium text-slate-600">Jusqu&apos;à (h)<input name="end" type="number" min={1} max={24} defaultValue={18} className={`${INPUT} mt-1`} /></label>
          </div>
          <div className="sm:col-span-2"><SubmitButton className="adm-btn-primary">Importer et préparer l&apos;aperçu</SubmitButton></div>
        </form>
      </section>

      {preview && (
        <section className="flexco-info-panel">
          <h2 className="font-semibold text-navy-900">3. Aperçu : « {preview.name} »</h2>
          <p className="mt-1 text-sm text-slate-600">{preview.total} prospect(s). Premier message tel qu&apos;il sera reçu :</p>
          {preview.samples.map((s) => <p key={s.to} className="mt-2 rounded-xl bg-slate-50 p-3 text-sm">{s.intro}</p>)}
          {preview.followupText && <p className="mt-2 text-xs text-slate-500">Relance unique (sans réponse) : {preview.followupText}</p>}
          <ul className="mt-3 list-disc pl-5 text-xs text-slate-600">{preview.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          {!preview.templatesReady && <p className="mt-2 text-xs text-amber-800">Modèles Meta non approuvés : vous pouvez valider, mais rien ne partira avant leur approbation.</p>}
          {(preview.status === "draft" || preview.status === "paused") && (
            <form action={approveAction} className="mt-3 flex flex-col gap-2">
              {idInput}
              <input type="hidden" name="campaignId" value={preview.campaignId} />
              <input type="hidden" name="fingerprint" value={preview.fingerprint} />
              <label className="text-xs font-medium text-slate-600">Base de contact de ces numéros (obligatoire : clients, demandes d&apos;information, salon…)
                <textarea name="consentBasis" required minLength={10} maxLength={500} rows={2} className={`${INPUT} mt-1`} />
              </label>
              <p className="text-xs text-amber-800">Écrire à des personnes qui n&apos;ont pas donné leur accord expose votre numéro WhatsApp à des signalements, voire à un blocage par Meta.</p>
              <ConfirmSubmitButton message="Valider cette campagne ? Les messages partiront automatiquement dans le plafond et les horaires indiqués.">Valider la campagne</ConfirmSubmitButton>
            </form>
          )}
        </section>
      )}

      <section className="flexco-info-panel">
        <h2 className="font-semibold text-navy-900">Campagnes</h2>
        {campaigns.length === 0 && <p className="mt-2 text-sm text-slate-500">Aucune campagne.</p>}
        {campaigns.map((c) => (
          <div key={c.id} className="mt-3 rounded-xl border border-navy-900/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{c.name} <span className="text-xs text-slate-500">· {STATUS_LABELS[c.status] ?? c.status} · {c.dailyCap}/jour</span></p>
              <div className="flex gap-2">
                <a href={`${BASE}?campaign=${c.id}`} className="adm-btn-secondary">Aperçu</a>
                {(c.status === "approved" || c.status === "running") && (
                  <form action={statusAction}>{idInput}<input type="hidden" name="campaignId" value={c.id} /><input type="hidden" name="action" value="pause" /><SubmitButton className="adm-btn-secondary">Suspendre</SubmitButton></form>
                )}
                {c.status === "paused" && (
                  <form action={statusAction}>{idInput}<input type="hidden" name="campaignId" value={c.id} /><input type="hidden" name="action" value="resume" /><ConfirmSubmitButton message="Reprendre les envois ?">Reprendre</ConfirmSubmitButton></form>
                )}
                {c.status !== "cancelled" && c.status !== "completed" && (
                  <form action={statusAction}>{idInput}<input type="hidden" name="campaignId" value={c.id} /><input type="hidden" name="action" value="cancel" /><ConfirmSubmitButton message="Annuler définitivement cette campagne ?">Annuler</ConfirmSubmitButton></form>
                )}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-600">{Object.entries(c.counts).map(([k, v]) => `${COUNT_LABELS[k] ?? k} : ${v}`).join(" · ") || "vide"}</p>
          </div>
        ))}
        {!templatesReady && campaigns.length > 0 && <p className="mt-2 text-xs text-amber-800">Premier message non approuvé par Meta : aucun envoi pour l&apos;instant.</p>}
      </section>
    </div>
  );
}
