/**
 * Domaine du programme d'affiliation plateforme — voir
 * docs/AFFILIATE_SYSTEM.md pour la vue d'ensemble et
 * supabase/migrations/0044_affiliate_system.sql pour le schéma.
 *
 * Règle absolue du dossier `domain/` (docs/ARCHITECTURE.md) : ZÉRO import
 * de Next.js, `@supabase/*`, ou d'un SDK provider. Toute la logique de
 * calcul de commission/éligibilité vit ICI, en fonctions pures
 * testables en isolation — `application/services/affiliate-service.ts`
 * n'y ajoute que l'orchestration (lecture/écriture Supabase), jamais de
 * règle métier dupliquée.
 */

export type AffiliateStatus = "pending" | "active" | "suspended" | "rejected";
export type ReferralAttributionMethod = "cookie" | "manual";
export type ReferralStatus = "pending" | "converted" | "reversed";
export type ConversionStatus = "pending_hold" | "approved" | "reversed" | "paid";
export type PayoutStatus = "requested" | "approved" | "rejected" | "paid";
export type FraudFlagType =
  | "self_referral"
  | "click_velocity"
  | "ip_reuse_across_affiliates"
  | "cookie_tampered"
  | "duplicate_organization_owner";
export type FraudSeverity = "low" | "medium" | "high";

export interface PayoutMethod {
  type: "mobile_money" | "bank_transfer";
  operator?: string; // ex: "mtn" | "orange" (mobile_money uniquement)
  accountName?: string;
  accountNumber: string;
}

/**
 * Calcule la commission due sur un montant payé, en FCFA (jamais de
 * décimale — même discipline que `subscription_payments.amount_fcfa`).
 * `Math.round` plutôt que `Math.floor`/`Math.ceil` : ni systématiquement
 * favorable à la plateforme ni à l'affilié, un arrondi neutre au FCFA le
 * plus proche.
 */
export function computeCommissionAmountFcfa(amountFcfa: number, commissionRateBps: number): number {
  if (amountFcfa < 0) throw new Error("amountFcfa ne peut pas être négatif.");
  if (commissionRateBps < 0 || commissionRateBps > 10000) {
    throw new Error("commissionRateBps doit être compris entre 0 et 10000.");
  }
  return Math.round((amountFcfa * commissionRateBps) / 10000);
}

/**
 * Détermine si le N-ième paiement d'une organisation référée génère
 * encore une commission, selon le réglage plateforme en vigueur
 * (`platform_settings.affiliate_recurring_months` — un seul réglage
 * global, pas de palier par affilié, décision produit du programme).
 *
 * `sequenceNumber` = 1 pour le tout premier paiement réussi de
 * l'organisation, 2 pour le suivant, etc. (voir
 * affiliate-service.ts::recordAffiliateConversion, qui le calcule à
 * partir de `affiliate_referrals.conversions_count + 1`).
 *
 * - `recurringMonths === -1` -> toujours éligible (commission à vie).
 * - `recurringMonths === 0`  -> seul sequenceNumber === 1 est éligible.
 * - `recurringMonths === N`  -> éligible pour sequenceNumber <= N + 1
 *   (le premier paiement + N renouvellements).
 */
export function isConversionEligible(sequenceNumber: number, recurringMonths: number): boolean {
  if (sequenceNumber < 1) throw new Error("sequenceNumber doit être >= 1.");
  if (recurringMonths === -1) return true;
  return sequenceNumber <= recurringMonths + 1;
}

/**
 * Fenêtre de rétention avant qu'une commission `pending_hold` ne devienne
 * payable (protection anti-remboursement/chargeback — voir
 * platform_settings.affiliate_hold_period_days, réglage Super Admin).
 */
export function computeHoldReleaseAt(fromDate: Date, holdPeriodDays: number): Date {
  const release = new Date(fromDate);
  release.setUTCDate(release.getUTCDate() + Math.max(0, holdPeriodDays));
  return release;
}

export function isHoldExpired(holdReleaseAt: Date, now: Date): boolean {
  return now.getTime() >= holdReleaseAt.getTime();
}

/**
 * Même charset/longueur que la contrainte CHECK de `affiliate_links.code`
 * (0044_affiliate_system.sql) — dupliqué volontairement ici en TypeScript
 * pur pour pouvoir valider un code AVANT d'atteindre la base (retour
 * d'erreur immédiat côté formulaire), la contrainte SQL restant le
 * garde-fou de dernier recours.
 */
const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

export function isValidReferralCode(code: string): boolean {
  return REFERRAL_CODE_PATTERN.test(code);
}

/**
 * Détecte l'auto-référencement (un affilié qui utiliserait son propre
 * lien pour créer une organisation et se verser une commission à
 * lui-même) — la fraude la plus triviale à commettre, donc bloquée à la
 * source plutôt que seulement flaguée pour revue (contrairement aux
 * autres heuristiques de fraude, best-effort/non bloquantes — voir
 * affiliate-service.ts::attributeReferral).
 */
export function isSelfReferral(affiliateUserId: string, newOrganizationOwnerId: string): boolean {
  return affiliateUserId === newOrganizationOwnerId;
}

/**
 * Seuil de vélocité de clics (section fraude) : plus de
 * `MAX_CLICKS_PER_IP_WINDOW` clics depuis le même `ip_hash` en moins de
 * `IP_VELOCITY_WINDOW_MINUTES` minutes -> flag `click_velocity` (jamais
 * bloquant, juste visible en revue admin — un pic de trafic légitime
 * viral reste possible et ne doit jamais empêcher un vrai visiteur de
 * continuer vers la landing page).
 */
export const IP_VELOCITY_WINDOW_MINUTES = 10;
export const MAX_CLICKS_PER_IP_WINDOW = 20;

export function exceedsClickVelocity(clicksInWindow: number): boolean {
  return clicksInWindow > MAX_CLICKS_PER_IP_WINDOW;
}

/** Solde "disponible" affiché au dashboard affilié : commissions approuvées, jamais encore incluses dans un payout payé. */
export interface AffiliateBalanceSummary {
  pendingHoldFcfa: number;
  availableFcfa: number;
  paidFcfa: number;
}

export function summarizeBalance(
  conversions: { status: ConversionStatus; commissionAmountFcfa: number }[],
): AffiliateBalanceSummary {
  let pendingHoldFcfa = 0;
  let availableFcfa = 0;
  let paidFcfa = 0;

  for (const c of conversions) {
    if (c.status === "pending_hold") pendingHoldFcfa += c.commissionAmountFcfa;
    else if (c.status === "approved") availableFcfa += c.commissionAmountFcfa;
    else if (c.status === "paid") paidFcfa += c.commissionAmountFcfa;
    // 'reversed' n'entre dans aucun total : commission jamais due.
  }

  return { pendingHoldFcfa, availableFcfa, paidFcfa };
}

export function canRequestPayout(availableFcfa: number, minPayoutFcfa: number): boolean {
  return availableFcfa >= minPayoutFcfa && availableFcfa > 0;
}
