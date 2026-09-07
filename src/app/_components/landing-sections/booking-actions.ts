"use server";

import { redirect } from "next/navigation";
import { createAppointment } from "@/application/services/appointment-service";
import { notifyOrgAdmins } from "@/application/services/notification-service";
import { AppError, ValidationError } from "@/lib/errors";

const DURATION_OPTIONS_MINUTES = [30, 60, 90, 120];

// Même raisonnement que dashboard/appointments/page.tsx::LOCAL_UTC_OFFSET
// (Cameroun, Africa/Douala, UTC+1 fixe, pas d'heure d'été) — figé ici
// pour ne pas dépendre du fuseau du serveur.
const LOCAL_UTC_OFFSET = "+01:00";

function toUtcIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00${LOCAL_UTC_OFFSET}`).toISOString();
}

/**
 * Demande de rendez-vous publique — appelée depuis un visiteur anonyme de
 * la vitrine, PAS depuis le dashboard authentifié, donc aucune vérification
 * `requireMembership()` ici (aucune session à vérifier, voir
 * track-click-action.ts pour le même raisonnement appliqué au tracking de
 * clics). C'est précisément pour éviter d'écrire `appointments`
 * directement depuis le navigateur avec la clé anon (RLS ne le
 * permettrait de toute façon pas) que cette action passe par le serveur.
 *
 * `createAppointment` insère avec `status: "scheduled"` (valeur par
 * défaut de la colonne, cahier appointment-service.ts) — exactement
 * l'état "en attente de confirmation" attendu pour une demande publique
 * non encore validée par le commerçant, qui peut ensuite confirmer/
 * annuler depuis /dashboard/appointments comme pour tout rendez-vous.
 *
 * Redirige avec `?bookingSuccess=`/`?bookingError=` vers `/` — même
 * pattern success/error par redirect que le reste du projet
 * (dashboard/appointments, dashboard/site), appliqué ici à une page
 * publique plutôt qu'authentifiée.
 */
export async function requestAppointmentAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "");
  if (!organizationId) {
    redirect(`/?bookingError=${encodeURIComponent("Requête invalide.")}`);
  }

  try {
    const date = String(formData.get("date") ?? "");
    const time = String(formData.get("time") ?? "");
    if (!date || !time) {
      throw new ValidationError("Choisissez une date et une heure.");
    }

    const durationMinutes = Number(formData.get("duration") ?? 60);
    if (!DURATION_OPTIONS_MINUTES.includes(durationMinutes)) {
      throw new ValidationError("Durée invalide.");
    }

    const startAt = toUtcIso(date, time);
    const endAt = new Date(new Date(startAt).getTime() + durationMinutes * 60_000).toISOString();

    // Vérification additionnelle propre à ce flow PUBLIC (pas dans
    // appointment-service.ts, qui reste utilisable côté staff pour
    // ressaisir un rendez-vous passé si besoin — un visiteur, lui, ne
    // doit jamais pouvoir "réserver" une date déjà écoulée).
    if (new Date(startAt).getTime() < Date.now()) {
      throw new ValidationError("Choisissez une date future.");
    }

    const contactFullName = String(formData.get("contactName") ?? "").trim();
    const serviceLabel = String(formData.get("serviceLabel") ?? "").trim() || "Rendez-vous";

    const { appointmentId } = await createAppointment({
      organizationId,
      contactFullName,
      contactPhone: String(formData.get("contactPhone") ?? "").trim() || undefined,
      serviceLabel,
      startAt,
      endAt,
      notes: String(formData.get("notes") ?? "").trim() || undefined,
    });

    // Best-effort, ne fait jamais échouer la demande de rendez-vous elle-
    // même si la notification échoue (voir notification-service.ts).
    await notifyOrgAdmins({
      organizationId,
      title: "Nouvelle demande de rendez-vous",
      body: `${contactFullName} demande un rendez-vous (${serviceLabel}).`,
      relatedEntityType: "appointment",
      relatedEntityId: appointmentId,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Impossible d'envoyer votre demande. Réessayez.";
    redirect(`/?bookingError=${encodeURIComponent(message)}#booking`);
  }

  redirect(`/?bookingSuccess=${encodeURIComponent("Votre demande a bien été envoyée !")}#booking`);
}
