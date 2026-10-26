/**
 * État d'un abonnement → plan qui gouverne réellement les droits (logique pure, sans E/S).
 *
 * Règle (décision Q7 : rétrogradation automatique avec délai de grâce de 3 jours) :
 *  - plan gratuit : toujours « free » ;
 *  - `active`   : plan payant tant que l'échéance n'est pas dépassée de plus de 3 jours
 *                 (le temps que le cron de renouvellement la traite) ;
 *  - `past_due` : plan payant jusqu'à l'échéance + 3 jours, puis « free » ;
 *  - `trialing` : plan payant jusqu'à la fin de l'essai + 3 jours, puis « free » ;
 *  - `cancelled`: plan payant jusqu'à la fin de la période déjà payée (sans grâce), puis « free ».
 * Sans échéance connue (attribution manuelle par la plateforme) : le plan est conservé.
 */
export const GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionStateInput {
  planKey: string;
  status: string;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
}

export function dueDateOf(sub: Pick<SubscriptionStateInput, "status" | "currentPeriodEnd" | "trialEnd">): Date | null {
  const raw = sub.status === "trialing" ? (sub.trialEnd ?? sub.currentPeriodEnd) : (sub.currentPeriodEnd ?? sub.trialEnd);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function graceEndsAt(due: Date): Date {
  return new Date(due.getTime() + GRACE_DAYS * DAY_MS);
}

/** Vrai si l'abonnement payant a perdu ses droits (échéance + grâce dépassées, ou résiliation arrivée à terme). */
export function isEntitlementExpired(sub: SubscriptionStateInput, now: Date = new Date()): boolean {
  if (sub.planKey === "free") return false;
  const due = dueDateOf(sub);
  if (!due) return false;
  if (sub.status === "cancelled") return now > due;
  return now > graceEndsAt(due);
}

export function effectivePlanKey<T extends string>(sub: SubscriptionStateInput & { planKey: T }, now: Date = new Date()): T | "free" {
  return isEntitlementExpired(sub, now) ? "free" : sub.planKey;
}
