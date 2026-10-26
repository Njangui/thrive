"use server";

import { revalidatePath } from "next/cache";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { generateChannelLinkCode, revokeChannelIdentity } from "@/application/services/channel-identity-service";
import { SupabaseStepUpAdapter } from "@/infrastructure/channels/supabase-step-up-adapter";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Actions de l'écran Sécurité. L'acteur vient TOUJOURS de la session
 * (`requireDashboardActor`) : aucun identifiant de membre ou de tenant n'est lu
 * dans le formulaire. Aucun PIN ni code n'est journalisé.
 */
export type LinkState = { code?: string; deepLink?: string; expiresAt?: string; error?: string };
export type PinState = { ok?: boolean; error?: string };

const errorMessage = (e: unknown, fallback: string) => (e instanceof AppError ? e.message : fallback);

export async function generateTelegramLinkAction(_prev: LinkState): Promise<LinkState> {
  try {
    const actor = await requireDashboardActor();
    const res = await generateChannelLinkCode({ organizationId: actor.tenantId, userId: actor.userId, channel: "telegram" });
    if (!res.ok) return { error: res.reason === "rate_limited" ? "Trop de codes générés. Réessayez dans une heure." : "Vous n'êtes pas membre de cette entreprise." };
    const bot = env.TELEGRAM_BOT_USERNAME;
    return { code: res.code, expiresAt: res.expiresAt, deepLink: bot ? `https://t.me/${bot}?start=${res.code}` : undefined };
  } catch (e) {
    console.error("[security] génération du code impossible:", e);
    return { error: errorMessage(e, "Impossible de générer le code.") };
  }
}

export async function revokeIdentityAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor();
  const identityId = String(formData.get("identityId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(identityId)) return;
  try {
    await revokeChannelIdentity({ organizationId: actor.tenantId, identityId, callerUserId: actor.userId, reason: "dashboard" });
  } catch (e) {
    console.error("[security] révocation impossible:", e);
  }
  revalidatePath("/dashboard/security");
}

const PIN_ERRORS: Record<string, string> = {
  format: "Le PIN doit contenir 6 à 8 chiffres.",
  too_weak: "PIN trop simple (suite, chiffre répété…). Choisissez-en un moins prévisible.",
  current_pin_required: "Saisissez votre PIN actuel pour le changer.",
  current_pin_invalid: "PIN actuel incorrect.",
  locked: "PIN verrouillé temporairement après trop d'essais. Réessayez plus tard.",
};

export async function setPinAction(_prev: PinState, formData: FormData): Promise<PinState> {
  try {
    const actor = await requireDashboardActor();
    const pin = String(formData.get("pin") ?? "");
    const confirm = String(formData.get("pinConfirm") ?? "");
    const current = String(formData.get("currentPin") ?? "");
    if (pin !== confirm) return { error: "Les deux PIN ne correspondent pas." };
    const result = await new SupabaseStepUpAdapter().setPin({ organizationId: actor.tenantId, membershipId: actor.membershipId, pin, currentPin: current || undefined });
    if (!result.ok) return { error: PIN_ERRORS[result.reason] ?? "PIN refusé." };
    revalidatePath("/dashboard/security");
    return { ok: true };
  } catch (e) {
    console.error("[security] enregistrement du PIN impossible:", e);
    return { error: errorMessage(e, "Impossible d'enregistrer le PIN.") };
  }
}

export async function resetPinAction(): Promise<void> {
  const actor = await requireDashboardActor();
  try {
    await new SupabaseStepUpAdapter().resetPin({ organizationId: actor.tenantId, membershipId: actor.membershipId, resetByUserId: actor.userId });
  } catch (e) {
    console.error("[security] réinitialisation du PIN impossible:", e);
  }
  revalidatePath("/dashboard/security");
}
