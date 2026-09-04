"use client";

import type { ServiceSummary } from "@/application/services/landing-config-service";
import { requestAppointmentAction } from "./booking-actions";
import { SubmitButton } from "../submit-button";

const DURATION_OPTIONS = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1h" },
  { minutes: 90, label: "1h30" },
  { minutes: 120, label: "2h" },
];

const INPUT_CLASS = "rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-brand";

export function BookingForm({
  organizationId,
  services,
}: {
  organizationId: string;
  services: ServiceSummary[];
}) {
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <form action={requestAppointmentAction} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <label className="flex flex-col gap-1 text-sm">
        Votre nom
        <input name="contactName" required className={INPUT_CLASS} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Téléphone (optionnel)
        <input name="contactPhone" type="tel" placeholder="+237 6XX XXX XXX" className={INPUT_CLASS} />
      </label>

      {services.length > 0 ? (
        <label className="flex flex-col gap-1 text-sm">
          Service souhaité
          <select name="serviceLabel" required defaultValue="" className={INPUT_CLASS}>
            <option value="" disabled>
              Choisissez un service
            </option>
            {services.map((service) => (
              <option key={service.id} value={service.name}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          Objet du rendez-vous
          <input name="serviceLabel" required placeholder="Ex : consultation" className={INPUT_CLASS} />
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Date
          <input name="date" type="date" required min={todayIso} className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Heure
          <input name="time" type="time" required className={INPUT_CLASS} />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Durée souhaitée
        <select name="duration" defaultValue={60} className={INPUT_CLASS}>
          {DURATION_OPTIONS.map((option) => (
            <option key={option.minutes} value={option.minutes}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Message (optionnel)
        <textarea name="notes" rows={2} className={INPUT_CLASS} />
      </label>

      <SubmitButton
        pendingLabel="Envoi..."
        className="rounded-brand bg-brand px-4 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        Envoyer ma demande
      </SubmitButton>
    </form>
  );
}
