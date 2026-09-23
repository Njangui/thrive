import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { isGatedFeatureEnabled } from "@/application/services/feature-gate-service";
import { isFeatureEnabled } from "@/application/services/entitlements-service";
import {
  BROADCAST_CHANNELS,
  BROADCAST_CHANNEL_LABELS,
  MAX_BROADCAST_CONTENT_LENGTH,
  MAX_BROADCASTS_PER_DAY,
  cancelContactBroadcast,
  createContactBroadcast,
  effectiveRecipientCap,
  listContactBroadcasts,
  previewBroadcastAudience,
  type BroadcastChannel,
} from "@/application/services/contact-broadcast-service";
import { SubmitButton } from "@/app/_components/submit-button";
import { UpgradeNotice } from "@/app/dashboard/_components/upgrade-notice";
import { AppError } from "@/lib/errors";

/**
 * Lot O — Diffusions vers vos contacts (Starter 50, Pro 100 contacts par
 * campagne). Envoi via la conversation existante de chaque contact, sur son
 * canal d'origine (Telegram, WhatsApp, Messenger, Instagram).
 */
async function createBroadcastAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin", "manager", "sales"]);
  let outcome: { ok: true; recipients: number } | { ok: false; message: string };
  try {
    const channels = formData.getAll("channels").map(String) as BroadcastChannel[];
    const { recipients } = await createContactBroadcast({
      organizationId,
      actorUserId: membership.userId,
      name: String(formData.get("name") ?? ""),
      content: String(formData.get("content") ?? ""),
      audience: { channels, recentDays: Number(formData.get("recentDays") ?? 30) },
      scheduledFor: String(formData.get("scheduledFor") ?? "") || null,
    });
    outcome = { ok: true, recipients };
  } catch (error) {
    outcome = { ok: false, message: error instanceof AppError ? error.message : error instanceof Error ? error.message : "Création impossible." };
  }
  if (!outcome.ok) redirect(`/dashboard/broadcasts?error=${encodeURIComponent(outcome.message)}`);
  redirect(`/dashboard/broadcasts?success=${encodeURIComponent(`Campagne programmée pour ${outcome.recipients} contact(s).`)}`);
}

async function cancelBroadcastAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager", "sales"]);
  let message: string | null = null;
  try {
    await cancelContactBroadcast(organizationId, String(formData.get("broadcastId") ?? ""));
  } catch (error) {
    message = error instanceof AppError ? error.message : "Annulation impossible.";
  }
  if (message) redirect(`/dashboard/broadcasts?error=${encodeURIComponent(message)}`);
  redirect(`/dashboard/broadcasts?success=${encodeURIComponent("Campagne annulée.")}`);
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Programmée",
  processing: "En cours",
  completed: "Terminée",
  partial: "Terminée (partielle)",
  failed: "Échec",
  cancelled: "Annulée",
};

const inputClass = "w-full rounded-xl border border-navy-900/10 bg-white px-3 py-2 text-sm";

export default async function BroadcastsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  if (!(await isGatedFeatureEnabled(organizationId, "contact_broadcasts"))) return <UpgradeNotice feature="contact_broadcasts" />;

  const [{ limit }, broadcasts, preview] = await Promise.all([
    isFeatureEnabled(organizationId, "broadcast_contacts"),
    listContactBroadcasts(organizationId),
    previewBroadcastAudience(organizationId, { channels: [...BROADCAST_CHANNELS], recentDays: 30 }).catch(() => null),
  ]);
  const cap = effectiveRecipientCap(limit);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Diffusions aux contacts</h1>
        <p className="mt-1 text-sm text-slate-500">
          Envoyez une même annonce à vos contacts, sur le canal où ils vous écrivent. Jusqu&apos;à {limit === -1 ? "500" : cap} contacts par campagne, {MAX_BROADCASTS_PER_DAY} campagnes par jour.
        </p>
      </div>

      {success && <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <form action={createBroadcastAction} className="adm-card flex flex-col gap-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <h2 className="adm-heading-2 text-lg">Nouvelle campagne</h2>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Nom (pour vous)
          <input name="name" required minLength={2} maxLength={80} className={inputClass} placeholder="Promo de la rentrée" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Message
          <textarea name="content" required rows={5} maxLength={MAX_BROADCAST_CONTENT_LENGTH} className={inputClass} placeholder="Bonjour ! Découvrez nos nouveautés de la semaine…" />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Canaux</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {BROADCAST_CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-2">
                <input type="checkbox" name="channels" value={channel} defaultChecked className="h-4 w-4 accent-violet-600" />
                {BROADCAST_CHANNEL_LABELS[channel]}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            WhatsApp, Messenger et Instagram : règle Meta — seuls les contacts qui vous ont écrit dans les dernières 24 h reçoivent le message (les autres sont ignorés et indiqués dans le suivi). Telegram : tous les contacts du bot.
          </p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Contacts actifs sur les
            <select name="recentDays" defaultValue="30" className={inputClass}>
              <option value="7">7 derniers jours</option>
              <option value="30">30 derniers jours</option>
              <option value="90">90 derniers jours</option>
              <option value="365">12 derniers mois</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Envoi (heure de Douala) — vide = maintenant
            <input name="scheduledFor" type="datetime-local" className={inputClass} />
          </label>
        </div>
        {preview ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Aperçu (tous canaux, 30 jours) : {preview.total} contact(s) éligible(s), {preview.selected} retenu(s) (plafond {cap}). Les désinscrits (STOP) sont exclus.
          </p>
        ) : null}
        <div>
          <SubmitButton pendingLabel="Programmation…" className="adm-btn-primary disabled:opacity-60">Programmer la campagne</SubmitButton>
        </div>
      </form>

      <section className="adm-card">
        <h2 className="adm-heading-2 text-lg">Suivi des campagnes</h2>
        {broadcasts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Aucune campagne pour le moment.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {broadcasts.map((broadcast) => (
              <li key={broadcast.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-navy-900/10 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{broadcast.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{broadcast.content}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {STATUS_LABELS[broadcast.status] ?? broadcast.status} · {new Date(broadcast.scheduledAt).toLocaleString("fr-FR", { timeZone: "Africa/Douala" })} · {broadcast.channels.map((c) => BROADCAST_CHANNEL_LABELS[c as BroadcastChannel] ?? c).join(", ")}
                  </p>
                  <p className="mt-1 text-xs">
                    <span className="text-emerald-700">{broadcast.sent} envoyé(s)</span> · <span className="text-slate-500">{broadcast.skipped} ignoré(s)</span> · <span className="text-red-600">{broadcast.failed} échec(s)</span> · {broadcast.total} au total
                  </p>
                </div>
                {broadcast.status === "scheduled" ? (
                  <form action={cancelBroadcastAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="broadcastId" value={broadcast.id} />
                    <SubmitButton pendingLabel="…" className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60">Annuler</SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
