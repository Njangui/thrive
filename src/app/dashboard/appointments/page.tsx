import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import {
  createAppointment,
  listAppointments,
  updateAppointmentStatus,
  APPOINTMENT_STATUSES,
  type AppointmentStatus,
} from "@/application/services/appointment-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Prévu",
  confirmed: "Confirmé",
  completed: "Terminé",
  cancelled: "Annulé",
  no_show: "Absent",
};

const DURATION_OPTIONS_MINUTES = [15, 30, 45, 60, 90, 120];

// Cameroun (Africa/Douala) : décalage fixe UTC+1, pas d'heure d'été — voir
// organizations.timezone (défaut 'Africa/Douala', 0001_core_tenancy.sql).
// On fige cet offset plutôt que de laisser `new Date()` interpréter
// l'heure locale du SERVEUR (qui peut tourner en UTC en production et
// décalerait silencieusement chaque rendez-vous d'une heure).
const LOCAL_UTC_OFFSET = "+01:00";

function toUtcIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00${LOCAL_UTC_OFFSET}`).toISOString();
}

function formatLocalDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Africa/Douala",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function createAppointmentAction(formData: FormData) {
  "use server";

  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const date = String(formData.get("date") ?? "");
    const time = String(formData.get("time") ?? "");
    const durationMinutes = Number(formData.get("duration") ?? 30);
    const startAt = toUtcIso(date, time);
    const endAt = new Date(new Date(startAt).getTime() + durationMinutes * 60_000).toISOString();

    await createAppointment({
      organizationId,
      contactFullName: String(formData.get("contactName") ?? ""),
      contactPhone: String(formData.get("contactPhone") ?? "") || undefined,
      serviceLabel: String(formData.get("serviceLabel") ?? ""),
      startAt,
      endAt,
      notes: String(formData.get("notes") ?? "") || undefined,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la création du rendez-vous.";
    redirect(`/dashboard/appointments?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/appointments?success=" + encodeURIComponent("Rendez-vous ajouté."));
}

async function updateStatusAction(formData: FormData) {
  "use server";

  const organizationId = String(formData.get("organizationId") ?? "");
  const appointmentId = String(formData.get("appointmentId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await updateAppointmentStatus(
      appointmentId,
      organizationId,
      String(formData.get("status") ?? "scheduled") as AppointmentStatus,
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour du statut.";
    redirect(`/dashboard/appointments?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/appointments?success=" + encodeURIComponent("Statut mis à jour."));
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const appointments = await listAppointments(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Rendez-vous</h1>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      <div className="rounded-brand border border-ink/10 bg-white p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">Nouveau rendez-vous</h2>
        <form action={createAppointmentAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="organizationId" value={organizationId} />

          <label className="flex flex-col gap-1 text-sm">
            Client
            <input name="contactName" required className="rounded-brand border border-ink/15 px-4 py-3" />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Téléphone (optionnel)
            <input name="contactPhone" placeholder="+237..." className="rounded-brand border border-ink/15 px-4 py-3" />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Service
            <input name="serviceLabel" required placeholder="Ex : Coupe homme" className="rounded-brand border border-ink/15 px-4 py-3" />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Date
            <input name="date" type="date" required className="rounded-brand border border-ink/15 px-4 py-3" />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Heure
            <input name="time" type="time" required className="rounded-brand border border-ink/15 px-4 py-3" />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Durée
            <select name="duration" defaultValue={30} className="rounded-brand border border-ink/15 px-4 py-3">
              {DURATION_OPTIONS_MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Note (optionnel)
            <input name="notes" className="rounded-brand border border-ink/15 px-4 py-3" />
          </label>

          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Ajout en cours...">Ajouter le rendez-vous</SubmitButton>
          </div>
        </form>
      </div>

      <div className="overflow-x-auto rounded-brand border border-ink/10 bg-white">
        {appointments.length === 0 ? (
          <p className="p-6 text-sm text-muted">Aucun rendez-vous pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink/5 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">Service</th>
                <th className="px-4 py-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((appt) => (
                <tr key={appt.id} className="border-b border-ink/5 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2">{formatLocalDateTime(appt.startAt)}</td>
                  <td className="px-4 py-2">
                    {appt.contactName ?? "—"}
                    {appt.contactPhone && <span className="block text-xs text-muted">{appt.contactPhone}</span>}
                  </td>
                  <td className="px-4 py-2">{appt.serviceLabel}</td>
                  <td className="px-4 py-2">
                    <form action={updateStatusAction} className="flex items-center gap-2">
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="appointmentId" value={appt.id} />
                      <select
                        name="status"
                        defaultValue={appt.status}
                        className="rounded-brand border border-ink/15 px-2 py-1 text-xs outline-none focus:border-leaf"
                      >
                        {APPOINTMENT_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      <SubmitButton
                        pendingLabel="..."
                        className="rounded-brand bg-ink/5 px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-ink/10 disabled:opacity-60"
                      >
                        OK
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
