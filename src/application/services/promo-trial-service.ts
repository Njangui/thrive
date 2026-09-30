import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError } from "@/lib/errors";
import { writeAdminAuditLog } from "./admin-organizations-service";
import { notifyOrgAdmins } from "./notification-service";
import {
  DAY_MS,
  PROMO_DURATION_DAYS,
  PROMO_REMINDER_DAYS,
  effectiveEnd,
  getPromoPhase,
  getPromoTrial,
  resetPromoCache,
  writePromo,
  type PromoTrial,
} from "./promo-trial-core";

export { getActivePromo, getPromoPhase, getPromoTrial, effectiveEnd, PROMO_DURATION_DAYS, PROMO_REMINDER_DAYS } from "./promo-trial-core";
export type { PromoTrial, PromoPhase } from "./promo-trial-core";

/**
 * Essai « Pro offert à tout le monde » — actions Super Admin, rappels et
 * balayage de fin. Principe et lecture : voir `promo-trial-core.ts`.
 *
 * Aucune donnée client n'est modifiée : le plan EFFECTIF vaut Pro tant que
 * `now` est dans [startsAt, endsAt[ ; passé `endsAt`, la comparaison de
 * dates seule rend chaque compte à son vrai plan. Les comptes créés
 * pendant la fenêtre en profitent avec la même date de fin.
 */

/** Lance l'essai maintenant : fin fixe = maintenant + 14 jours, pour tous. */
export async function launchPromoTrial(actorUserId: string, now: Date = new Date()): Promise<PromoTrial> {
  const existing = await getPromoTrial();
  if (existing && getPromoPhase(existing, now) === "active") {
    throw new ValidationError("Un essai Pro est déjà en cours. Arrêtez-le d'abord si vous voulez le relancer.");
  }
  const promo: PromoTrial = {
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + PROMO_DURATION_DAYS * DAY_MS).toISOString(),
    reminderSentAt: null,
    endNoticeSentAt: null,
    creditsRevertedAt: null,
    stoppedAt: null,
  };
  await writePromo(promo);
  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    action: "PROMO_TRIAL_LAUNCHED",
    entityType: "platform_setting",
    beforeState: { promo: existing },
    afterState: { promo },
  });
  return promo;
}

/** Arrêt immédiat : la fenêtre se ferme maintenant, le balayage de fin rattrape le reste. */
export async function stopPromoTrial(actorUserId: string, now: Date = new Date()): Promise<void> {
  const existing = await getPromoTrial();
  if (!existing || getPromoPhase(existing, now) !== "active") {
    throw new ValidationError("Aucun essai Pro en cours.");
  }
  const promo: PromoTrial = { ...existing, stoppedAt: now.toISOString() };
  await writePromo(promo);
  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    action: "PROMO_TRIAL_STOPPED",
    entityType: "platform_setting",
    beforeState: { promo: existing },
    afterState: { promo },
  });
}

export function daysLeft(promo: PromoTrial, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((effectiveEnd(promo).getTime() - now.getTime()) / DAY_MS));
}

/**
 * Rappel J-3 puis message de fin, appelée par le cron d'abonnements déjà
 * planifié (aucun nouveau cron à configurer). Chaque message part une
 * seule fois : le drapeau est posé AVANT l'envoi (au pire un message
 * manqué, jamais un doublon). Les abonnés Pro payants ne sont pas
 * notifiés : rien ne change pour eux.
 */
export async function processPromoTrialNotifications(now: Date = new Date()): Promise<{
  reminderSent: number;
  endNoticeSent: number;
  creditsReverted: number;
}> {
  resetPromoCache();
  const promo = await getPromoTrial();
  const result = { reminderSent: 0, endNoticeSent: 0, creditsReverted: 0 };
  if (!promo) return result;

  const phase = getPromoPhase(promo, now);
  const end = effectiveEnd(promo);
  const supabase = getSupabaseServiceClient();

  const targets = async (): Promise<{ id: string; planKey: string }[]> => {
    const [{ data: orgs }, { data: subs }] = await Promise.all([
      supabase.from("organizations").select("id"),
      supabase.from("organization_subscriptions").select("organization_id, plan_key"),
    ]);
    const planByOrg = new Map((subs ?? []).map((s) => [s.organization_id as string, String(s.plan_key)]));
    return (orgs ?? [])
      .map((o) => ({ id: o.id as string, planKey: planByOrg.get(o.id as string) ?? "free" }))
      .filter((o) => o.planKey !== "pro");
  };

  const sendAll = async (list: { id: string; planKey: string }[], build: (planKey: string) => { title: string; body: string }) => {
    for (let i = 0; i < list.length; i += 20) {
      await Promise.allSettled(
        list.slice(i, i + 20).map((o) => {
          const { title, body } = build(o.planKey);
          return notifyOrgAdmins({ organizationId: o.id, title, body, relatedEntityType: "promo_trial", relatedEntityId: o.id });
        }),
      );
    }
  };

  // J-3 : uniquement pendant l'essai
  if (phase === "active" && !promo.reminderSentAt && now.getTime() >= end.getTime() - PROMO_REMINDER_DAYS * DAY_MS) {
    const next: PromoTrial = { ...promo, reminderSentAt: now.toISOString() };
    await writePromo(next);
    const list = await targets();
    await sendAll(list, () => ({
      title: "Votre essai Pro se termine dans 3 jours.",
      body: `Votre accès gratuit au forfait Pro s'arrête le ${end.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}. Passez à un forfait depuis Mon abonnement pour garder toutes les fonctionnalités.`,
    }));
    result.reminderSent = list.length;
  }

  // Fin : message + retrait du bonus de crédits IA
  if (phase === "ended") {
    let current = promo;
    if (!current.endNoticeSentAt) {
      current = { ...current, endNoticeSentAt: now.toISOString() };
      await writePromo(current);
      const list = await targets();
      await sendAll(list, (planKey) => ({
        title: "Votre essai Pro est terminé.",
        body:
          planKey === "free"
            ? "Votre compte est revenu à l'offre gratuite. Vos données sont conservées ; passez à un forfait depuis Mon abonnement pour retrouver les fonctionnalités Pro."
            : `Votre compte est revenu à votre forfait ${planKey === "starter" ? "Starter" : planKey}. Vos données sont conservées ; passez à Pro depuis Mon abonnement pour retrouver toutes les fonctionnalités.`,
      }));
      result.endNoticeSent = list.length;
    }
    if (!current.creditsRevertedAt) {
      result.creditsReverted = await revertAllPromoCredits();
      await writePromo({ ...current, creditsRevertedAt: now.toISOString() });
    }
  }

  return result;
}

/**
 * Balayage de fin : retire le bonus de crédits IA accordé pendant l'essai.
 * Le retrait « paresseux » (voir ai-credits-service) le fait déjà à la
 * première lecture après la fin ; ceci rattrape les comptes inactifs.
 */
export async function revertAllPromoCredits(): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("ai_credit_balances").select("organization_id, included_credits, promo_bonus_credits").gt("promo_bonus_credits", 0);
  if (error) {
    console.error("revertAllPromoCredits: lecture impossible:", error.message);
    return 0;
  }
  let reverted = 0;
  for (const row of data ?? []) {
    const { error: updateError } = await supabase
      .from("ai_credit_balances")
      .update({ included_credits: Math.max(0, (row.included_credits as number) - (row.promo_bonus_credits as number)), promo_bonus_credits: 0 })
      .eq("organization_id", row.organization_id)
      .eq("promo_bonus_credits", row.promo_bonus_credits);
    if (!updateError) reverted++;
  }
  return reverted;
}
