"use server";

import { revalidatePath } from "next/cache";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { acknowledgeAlert, saveAlertSettings } from "@/application/services/alert-service";
import { ALERT_TRIGGERS } from "@/application/alerts/alert-policy";
import { AppError } from "@/lib/errors";

/** L'acteur vient TOUJOURS de la session ; seuls propriétaire/admin modifient les réglages. */
export type SettingsState = { ok?: boolean; error?: string };

export async function saveAlertSettingsAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    const actor = await requireDashboardActor();
    if (actor.role !== "owner" && actor.role !== "admin") return { error: "Réservé au propriétaire et aux administrateurs." };
    const triggers: Record<string, { enabled: boolean; threshold?: number }> = {};
    for (const t of ALERT_TRIGGERS) {
      const raw = String(formData.get(`threshold:${t.key}`) ?? "").trim();
      const threshold = raw === "" ? undefined : Number(raw.replace(",", "."));
      triggers[t.key] = { enabled: formData.get(`enabled:${t.key}`) === "on", ...(t.thresholdUnit && threshold !== undefined && Number.isFinite(threshold) ? { threshold } : {}) };
    }
    const fallback = String(formData.get("fallbackMembershipId") ?? "");
    await saveAlertSettings(actor.tenantId, {
      triggers,
      quietEnabled: formData.get("quietEnabled") === "on",
      quietStart: String(formData.get("quietStart") ?? "22:00"),
      quietEnd: String(formData.get("quietEnd") ?? "07:00"),
      escalationDelayMinutes: Number(formData.get("escalationDelayMinutes") ?? 15),
      fallbackMembershipId: fallback === "" ? null : fallback,
    });
    revalidatePath("/dashboard/alerts");
    return { ok: true };
  } catch (e) {
    console.error("[alertes] enregistrement des réglages impossible:", e);
    return { error: e instanceof AppError ? e.message : "Impossible d'enregistrer les réglages." };
  }
}

export async function acknowledgeAlertAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor();
  const alertId = String(formData.get("alertId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(alertId)) return;
  try { await acknowledgeAlert({ alertId, organizationId: actor.tenantId, membershipId: actor.membershipId, via: "dashboard" }); }
  catch (e) { console.error("[alertes] accusé impossible:", e); }
  revalidatePath("/dashboard/alerts");
}
