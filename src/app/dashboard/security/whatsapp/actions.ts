"use server";

import { revalidatePath } from "next/cache";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { generateChannelLinkCode } from "@/application/services/channel-identity-service";
import { saveBackofficeSettings } from "@/application/services/whatsapp-backoffice-service";
import { ensureTemplates, syncTemplates } from "@/application/services/whatsapp-template-service";
import { AppError } from "@/lib/errors";

/** L'acteur vient TOUJOURS de la session ; réglages et modèles : propriétaire/admin uniquement. */
export type WaLinkState = { code?: string; expiresAt?: string; error?: string };
export type WaSettingsState = { ok?: boolean; error?: string };
export type WaTemplatesState = { message?: string; error?: string };

const isAdmin = (role: string) => role === "owner" || role === "admin";

export async function generateWhatsAppLinkAction(_prev: WaLinkState): Promise<WaLinkState> {
  try {
    const actor = await requireDashboardActor();
    const res = await generateChannelLinkCode({ organizationId: actor.tenantId, userId: actor.userId, channel: "whatsapp" });
    if (!res.ok) return { error: res.reason === "rate_limited" ? "Trop de codes générés. Réessayez dans une heure." : "Vous n'êtes pas membre de cette entreprise." };
    return { code: res.code, expiresAt: res.expiresAt };
  } catch (e) {
    console.error("[whatsapp-backoffice] génération du code impossible:", e);
    return { error: e instanceof AppError ? e.message : "Impossible de générer le code." };
  }
}

export async function saveWhatsAppSettingsAction(_prev: WaSettingsState, formData: FormData): Promise<WaSettingsState> {
  try {
    const actor = await requireDashboardActor();
    if (!isAdmin(actor.role)) return { error: "Réservé au propriétaire et aux administrateurs." };
    const dedicated = String(formData.get("dedicatedAccountId") ?? "");
    await saveBackofficeSettings(actor.tenantId, { enabled: formData.get("enabled") === "on", dedicatedAccountId: dedicated === "" ? null : dedicated });
    revalidatePath("/dashboard/security/whatsapp");
    return { ok: true };
  } catch (e) {
    console.error("[whatsapp-backoffice] réglages impossibles:", e);
    return { error: e instanceof AppError ? e.message : "Impossible d'enregistrer les réglages." };
  }
}

export async function submitTemplatesAction(_prev: WaTemplatesState): Promise<WaTemplatesState> {
  try {
    const actor = await requireDashboardActor();
    if (!isAdmin(actor.role)) return { error: "Réservé au propriétaire et aux administrateurs." };
    const r = await ensureTemplates(actor.tenantId);
    revalidatePath("/dashboard/security/whatsapp");
    if (!r.ok) return { error: "Aucun numéro WhatsApp connecté. Connectez-le dans Canaux." };
    if (r.failed.length > 0) return { error: `${r.failed.length} modèle(s) refusé(s) à l'envoi : ${r.failed[0]!.message}` };
    return { message: r.submitted.length > 0 ? "Modèles envoyés à Meta pour validation (quelques minutes à 24 h)." : "Tous les modèles ont déjà été envoyés." };
  } catch (e) {
    console.error("[whatsapp-backoffice] soumission des modèles impossible:", e);
    return { error: "Impossible d'envoyer les modèles pour le moment." };
  }
}

export async function refreshTemplatesAction(_prev: WaTemplatesState): Promise<WaTemplatesState> {
  try {
    const actor = await requireDashboardActor();
    if (!isAdmin(actor.role)) return { error: "Réservé au propriétaire et aux administrateurs." };
    const r = await syncTemplates(actor.tenantId);
    revalidatePath("/dashboard/security/whatsapp");
    return r.ok ? { message: "Statuts actualisés." } : { error: "Aucun numéro WhatsApp connecté." };
  } catch (e) {
    console.error("[whatsapp-backoffice] actualisation des modèles impossible:", e);
    return { error: "Impossible d'actualiser pour le moment." };
  }
}
