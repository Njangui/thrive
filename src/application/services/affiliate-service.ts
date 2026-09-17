import { randomUUID } from "node:crypto";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { getNotificationProvider } from "@/infrastructure/providers/registry";
import { TelegramClient } from "@/infrastructure/providers/telegram/client";
import { AuthenticationError, ValidationError } from "@/lib/errors";
import { env } from "@/lib/env";
import {
  computeCommissionAmountFcfa,
  computeDiscountedAmountFcfa,
  computeHoldReleaseAt,
  exceedsClickVelocity,
  isConversionEligible,
  isSelfReferral,
  isValidReferralCode,
  summarizeBalance,
  IP_VELOCITY_WINDOW_MINUTES,
  type AffiliateBalanceSummary,
  type ConversionStatus,
  type PayoutMethod,
} from "@/domain/entities/affiliate";
import {
  AFFILIATE_COOKIE_NAME,
  generateReferralCode,
  hashForFraudDetection,
  signReferralToken,
  verifyReferralToken,
} from "./affiliate-link-security";
import { getPlatformSettingNumber } from "./platform-settings-service";

/**
 * Cœur du programme d'affiliation — candidature, gestion des liens de
 * suivi, enregistrement des clics (avec heuristiques anti-fraude),
 * attribution d'une organisation à un affilié, et calcul des commissions
 * à chaque paiement d'abonnement confirmé. Voir docs/AFFILIATE_SYSTEM.md
 * pour la vue d'ensemble du flux complet.
 *
 * Toutes les fonctions déclenchées par un flux SYSTÈME (attribution au
 * signup, conversion au paiement) sont best-effort — elles ne lèvent
 * JAMAIS d'exception qui remonterait à l'appelant : un problème
 * d'attribution/commission ne doit jamais faire échouer la création
 * d'une organisation ni la confirmation d'un paiement (même discipline
 * que `notifyOrgAdmins`/`sendPush`).
 */

// ------------------------------------------------------------
// Candidature
// ------------------------------------------------------------

export interface AffiliateApplicationInput {
  displayName: string;
  contactEmail: string;
  phone?: string;
  promotionChannels?: string;
  payoutMethod?: PayoutMethod;
}

/**
 * Ouverte à TOUT utilisateur connecté (voir docs/AFFILIATE_SYSTEM.md,
 * décision produit) : un client SME-OS existant (déjà owner d'une
 * organisation) et un candidat totalement externe passent par exactement
 * le même formulaire — `affiliates.user_id` n'a aucun lien avec
 * `memberships`, les deux rôles coexistent sans conflit sur un même
 * compte Supabase Auth.
 */
export async function applyForAffiliate(input: AffiliateApplicationInput): Promise<{ affiliateId: string }> {
  const sessionClient = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    throw new AuthenticationError("Connectez-vous avant de candidater au programme d'affiliation.");
  }

  const displayName = input.displayName.trim();
  const contactEmail = input.contactEmail.trim();
  if (!displayName) throw new ValidationError("Le nom affiché est requis.");
  if (!contactEmail || !contactEmail.includes("@")) throw new ValidationError("Un email de contact valide est requis.");

  const supabase = getSupabaseServiceClient();

  const { data: existing, error: existingError } = await supabase
    .from("affiliates")
    .select("id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError) throw new Error(`Erreur lecture affiliates: ${existingError.message}`);
  if (existing) {
    throw new ValidationError(
      existing.status === "rejected"
        ? "Votre précédente candidature a été refusée. Contactez le support pour plus d'informations."
        : "Vous avez déjà une candidature ou un compte affilié actif.",
    );
  }

  const { data: created, error } = await supabase
    .from("affiliates")
    .insert({
      user_id: user.id,
      display_name: displayName.slice(0, 200),
      contact_email: contactEmail.slice(0, 320),
      phone: input.phone?.trim().slice(0, 40) || null,
      promotion_channels: input.promotionChannels?.trim().slice(0, 2000) || null,
      payout_method: input.payoutMethod ?? null,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Impossible d'enregistrer la candidature d'affiliation: ${error?.message}`);
  }

  await notifyPlatformOperators(
    "Nouvelle candidature affilié",
    `${displayName} (${contactEmail}) a candidaté au programme d'affiliation.`,
    "affiliate",
    created.id,
  );

  return { affiliateId: created.id };
}

// ------------------------------------------------------------
// Notification opérateur plateforme (best-effort, jamais bloquant)
// ------------------------------------------------------------

export async function notifyPlatformOperators(
  title: string,
  body: string,
  relatedEntityType?: string,
  relatedEntityId?: string,
): Promise<void> {
  try {
    const notifier = await getNotificationProvider();
    await notifier.send({ title, body, channel: "telegram", relatedEntityType, relatedEntityId });
  } catch (err) {
    console.warn("[affiliate] notification opérateur plateforme échouée:", err);
  }
}

/**
 * Envoie un message Telegram DIRECT à un affilié précis (pas une alerte
 * groupée opérateur) — utilisé pour confirmer une conversion/commission.
 * N'importe PAS telegram-bot-service.ts (qui importe ce fichier pour les
 * stats /mystats) afin d'éviter tout cycle d'import ; utilise directement
 * le client bas niveau, best-effort, silencieux si l'affilié n'a pas
 * lié son compte Telegram ou si le bot plateforme n'est pas configuré.
 */
async function notifyAffiliateTelegram(affiliateId: string, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  try {
    const supabase = getSupabaseServiceClient();
    const { data: link } = await supabase
      .from("telegram_links")
      .select("chat_id")
      .eq("affiliate_id", affiliateId)
      .eq("purpose", "affiliate")
      .eq("status", "linked")
      .maybeSingle();

    if (!link?.chat_id) return;

    await new TelegramClient(env.TELEGRAM_BOT_TOKEN).sendMessage({ chat_id: link.chat_id, text });
  } catch (err) {
    console.warn(`[affiliate] notification Telegram affilié échouée (${affiliateId}):`, err);
  }
}

export async function updateAffiliatePayoutMethod(affiliateId: string, method: PayoutMethod): Promise<void> {
  if (!method.accountNumber?.trim()) {
    throw new ValidationError("Le numéro de compte/mobile money est requis.");
  }
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("affiliates").update({ payout_method: method }).eq("id", affiliateId);
  if (error) throw new Error(`Impossible de mettre à jour la méthode de paiement: ${error.message}`);
}

// ------------------------------------------------------------
// Liens de suivi
// ------------------------------------------------------------

export interface AffiliateLinkSummary {
  id: string;
  code: string;
  label: string | null;
  destinationPath: string;
  isActive: boolean;
  clickCount: number;
  conversionCount: number;
  trackingUrl: string;
  createdAt: string;
}

interface AffiliateLinkRow {
  id: string;
  code: string;
  label: string | null;
  destination_path: string;
  is_active: boolean;
  click_count: number;
  conversion_count: number;
  created_at: string;
}

function buildTrackingUrl(code: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/r/${code}`;
}

function mapLinkRow(row: AffiliateLinkRow): AffiliateLinkSummary {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    destinationPath: row.destination_path,
    isActive: row.is_active,
    clickCount: row.click_count,
    conversionCount: row.conversion_count,
    trackingUrl: buildTrackingUrl(row.code),
    createdAt: row.created_at,
  };
}

const LINK_SELECT = "id, code, label, destination_path, is_active, click_count, conversion_count, created_at";
const MAX_CODE_GENERATION_ATTEMPTS = 5;

export async function createAffiliateLink(
  affiliateId: string,
  input: { label?: string; destinationPath?: string },
): Promise<AffiliateLinkSummary> {
  const destinationPath = input.destinationPath?.trim() || "/";
  if (!destinationPath.startsWith("/") || destinationPath.startsWith("//")) {
    throw new ValidationError("La destination doit être un chemin interne commençant par un seul /.");
  }

  const supabase = getSupabaseServiceClient();

  // Collision-safe : generateReferralCode() ne garantit pas l'unicité —
  // sur une violation de la contrainte unique `affiliate_links.code`
  // (probabilité négligeable sur 8 caractères parmi 57, jamais supposée
  // nulle), on retente avec un nouveau code plutôt que d'échouer.
  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
    const code = generateReferralCode();
    const { data, error } = await supabase
      .from("affiliate_links")
      .insert({
        affiliate_id: affiliateId,
        code,
        label: input.label?.trim().slice(0, 100) || null,
        destination_path: destinationPath,
      })
      .select(LINK_SELECT)
      .single();

    if (!error && data) return mapLinkRow(data as AffiliateLinkRow);
    if (error && error.code !== "23505") {
      throw new Error(`Impossible de créer le lien d'affiliation: ${error.message}`);
    }
    // code=23505 : collision, on boucle avec un nouveau code généré.
  }

  throw new Error("Impossible de générer un code de lien unique après plusieurs tentatives — réessayez.");
}

export async function listAffiliateLinks(affiliateId: string): Promise<AffiliateLinkSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("affiliate_links")
    .select(LINK_SELECT)
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Erreur lecture affiliate_links: ${error.message}`);
  return (data ?? []).map((row) => mapLinkRow(row as AffiliateLinkRow));
}

export async function setAffiliateLinkActive(affiliateId: string, linkId: string, isActive: boolean): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("affiliate_links")
    .update({ is_active: isActive })
    .eq("id", linkId)
    .eq("affiliate_id", affiliateId); // double barrière : un affilié ne peut jamais désactiver le lien d'un autre.

  if (error) throw new Error(`Impossible de mettre à jour le lien: ${error.message}`);
}

// ------------------------------------------------------------
// Clics (route publique /r/[code])
// ------------------------------------------------------------

export interface RecordClickInput {
  code: string;
  ip: string;
  userAgent: string | null;
  refererHost: string | null;
}

export interface RecordClickResult {
  cookieToken: string;
  destinationPath: string;
  cookieMaxAgeSeconds: number;
}

export async function recordClick(input: RecordClickInput): Promise<RecordClickResult | null> {
  if (!isValidReferralCode(input.code)) return null;

  const supabase = getSupabaseServiceClient();

  const { data: link, error } = await supabase
    .from("affiliate_links")
    .select("id, affiliate_id, destination_path, is_active, affiliates!inner(status)")
    .eq("code", input.code)
    .maybeSingle();

  if (error) {
    console.error(`recordClick: erreur lecture affiliate_links (${input.code}):`, error.message);
    return null;
  }
  const affiliateStatus = (link as unknown as { affiliates?: { status?: string } } | null)?.affiliates?.status;
  if (!link || !link.is_active || affiliateStatus !== "active") return null;

  const ipHash = hashForFraudDetection(input.ip);
  const userAgentHash = input.userAgent ? hashForFraudDetection(input.userAgent) : null;

  const since = new Date(Date.now() - IP_VELOCITY_WINDOW_MINUTES * 60_000).toISOString();
  const { count: recentClicksFromIp } = await supabase
    .from("affiliate_clicks")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  const suspicious = exceedsClickVelocity(recentClicksFromIp ?? 0);
  const clickToken = randomUUID();

  const { data: click, error: insertError } = await supabase
    .from("affiliate_clicks")
    .insert({
      link_id: link.id,
      affiliate_id: link.affiliate_id,
      click_token: clickToken,
      ip_hash: ipHash,
      user_agent_hash: userAgentHash,
      referer_host: input.refererHost,
      is_suspicious: suspicious,
      suspicious_reason: suspicious ? "click_velocity" : null,
    })
    .select("id")
    .single();

  if (insertError || !click) {
    console.error(`recordClick: échec insertion affiliate_clicks (${input.code}):`, insertError?.message);
    return null;
  }

  if (suspicious) {
    await supabase.from("affiliate_fraud_flags").insert({
      affiliate_id: link.affiliate_id,
      click_id: click.id,
      flag_type: "click_velocity",
      severity: "medium",
      details: { ipHash, recentClicksFromIp },
    });
  }

  await supabase.rpc("increment_affiliate_link_clicks", { p_link_id: link.id }).then(({ error: rpcError }) => {
    if (rpcError) console.warn(`recordClick: échec incrément compteur (link ${link.id}):`, rpcError.message);
  });

  const cookieWindowDays = await getPlatformSettingNumber("affiliate_cookie_window_days", 30);
  const cookieMaxAgeSeconds = Math.max(1, cookieWindowDays) * 24 * 60 * 60;
  const exp = Math.floor(Date.now() / 1000) + cookieMaxAgeSeconds;

  const cookieToken = signReferralToken({
    linkId: link.id,
    affiliateId: link.affiliate_id,
    clickId: click.id,
    exp,
  });

  return { cookieToken, destinationPath: link.destination_path, cookieMaxAgeSeconds };
}

// ------------------------------------------------------------
// Attribution (appelée depuis onboarding-service.ts::createOrganization)
// ------------------------------------------------------------

/**
 * Best-effort par construction — lit un cookie déjà résolu par
 * l'appelant (jamais `next/headers` ici, pour garder ce service testable
 * et indépendant du contexte de requête, voir onboarding-service.ts).
 */
export async function attributeReferral(
  organizationId: string,
  newOrganizationOwnerUserId: string,
  cookieValue: string | undefined | null,
): Promise<void> {
  try {
    const payload = verifyReferralToken(cookieValue);
    if (!payload) return; // pas de cookie valide — cas normal pour la grande majorité des signups.

    const supabase = getSupabaseServiceClient();
    const { data: affiliate, error: affiliateError } = await supabase
      .from("affiliates")
      .select("id, user_id, status")
      .eq("id", payload.affiliateId)
      .maybeSingle();

    if (affiliateError || !affiliate || affiliate.status !== "active") return;

    if (isSelfReferral(affiliate.user_id, newOrganizationOwnerUserId)) {
      await supabase.from("affiliate_fraud_flags").insert({
        affiliate_id: affiliate.id,
        click_id: payload.clickId,
        flag_type: "self_referral",
        severity: "high",
        details: { organizationId },
      });
      await notifyPlatformOperators(
        "Auto-référencement bloqué",
        `Un affilié a tenté de s'auto-référencer via son propre lien (organisation ${organizationId}). Aucune commission ne sera générée.`,
        "affiliate_fraud",
        affiliate.id,
      );
      return; // bloqué à la source — aucune ligne affiliate_referrals créée.
    }

    const { data: referral, error } = await supabase
      .from("affiliate_referrals")
      .insert({
        organization_id: organizationId,
        affiliate_id: affiliate.id,
        link_id: payload.linkId,
        click_id: payload.clickId,
        attribution_method: "cookie",
      })
      .select("id")
      .single();

    if (error || !referral) {
      // organization_id est fraîchement créé par l'appelant : une
      // violation de contrainte unique ici serait inattendue, mais on ne
      // lève jamais (voir contrat de fonction en tête de fichier).
      console.warn(`attributeReferral: échec insertion affiliate_referrals (org ${organizationId}):`, error?.message);
      return;
    }

    // Heuristique complémentaire (non bloquante) : ce même utilisateur
    // possède-t-il déjà une AUTRE organisation référée ? Un cas légitime
    // existe (plusieurs commerces réels) — on flague juste pour revue
    // admin, on ne bloque jamais l'attribution.
    const { data: ownerMemberships } = await supabase
      .from("memberships")
      .select("organization_id")
      .eq("user_id", newOrganizationOwnerUserId)
      .eq("role", "owner");

    const otherOwnedOrgIds = (ownerMemberships ?? [])
      .map((m) => m.organization_id)
      .filter((id) => id !== organizationId);

    if (otherOwnedOrgIds.length > 0) {
      const { count: otherReferralsCount } = await supabase
        .from("affiliate_referrals")
        .select("id", { count: "exact", head: true })
        .in("organization_id", otherOwnedOrgIds);

      if ((otherReferralsCount ?? 0) > 0) {
        await supabase.from("affiliate_fraud_flags").insert({
          affiliate_id: affiliate.id,
          referral_id: referral.id,
          flag_type: "duplicate_organization_owner",
          severity: "low",
          details: { organizationId, ownerUserId: newOrganizationOwnerUserId },
        });
      }
    }
  } catch (err) {
    console.warn(`attributeReferral: erreur inattendue (org ${organizationId}):`, err);
  }
}

// ------------------------------------------------------------
// Code promo (alternative au lien cliqué) — réutilise affiliate_links.code
// tel quel, mais économie différente (voir 0052_affiliate_promo_codes.sql) :
// commission réduite pour l'affilié, en échange d'une remise pour le
// client sur son 1er paiement. Contrairement à attributeReferral()
// (cookie, silencieux par design — l'immense majorité des signups n'a
// jamais cliqué de lien), un code TAPÉ par l'utilisateur doit produire
// une erreur explicite s'il est invalide : quelqu'un qui prend la peine
// de saisir un code s'attend à un retour, pas à un échec silencieux.
//
// Séparé en 2 étapes (validate puis attribute) pour que
// onboarding-service.ts::createOrganization puisse valider AVANT de
// créer l'organisation (rejet propre, aucune organisation à moitié
// créée à nettoyer si le code est invalide).
// ------------------------------------------------------------

export interface ValidatedPromoCode {
  affiliateId: string;
  linkId: string;
}

/**
 * Vérifie un code promo SANS écrire en base : existe-t-il, l'affilié
 * propriétaire est-il actif, et l'utilisateur qui s'inscrit n'est-il pas
 * l'affilié lui-même (même règle anti-fraude que isSelfReferral, vérifiée
 * ici aussi car ce chemin ne passe jamais par attributeReferral()).
 * Retourne `null` si invalide pour QUELQUE raison que ce soit — l'appelant
 * ne doit jamais distinguer "code inexistant" de "affilié suspendu" côté
 * utilisateur final (même principe que les messages d'auth : ne jamais
 * révéler pourquoi, juste que ça ne marche pas).
 */
export async function validatePromoCode(
  promoCode: string,
  newOrganizationOwnerUserId: string,
): Promise<ValidatedPromoCode | null> {
  if (!isValidReferralCode(promoCode)) return null;

  const supabase = getSupabaseServiceClient();
  const { data: link, error: linkError } = await supabase
    .from("affiliate_links")
    .select("id, affiliate_id, is_active")
    .eq("code", promoCode)
    .maybeSingle();

  if (linkError || !link || !link.is_active) return null;

  const { data: affiliate, error: affiliateError } = await supabase
    .from("affiliates")
    .select("id, user_id, status")
    .eq("id", link.affiliate_id)
    .maybeSingle();

  if (affiliateError || !affiliate || affiliate.status !== "active") return null;
  if (isSelfReferral(affiliate.user_id, newOrganizationOwnerUserId)) return null;

  return { affiliateId: affiliate.id, linkId: link.id };
}

/**
 * Crée la ligne affiliate_referrals pour un code promo déjà validé
 * (voir validatePromoCode) — appelée APRÈS la création de l'organisation,
 * jamais avant (organization_id doit déjà exister, contrainte FK).
 * Best-effort comme attributeReferral() : un échec ici ne doit jamais
 * faire échouer l'onboarding pour l'utilisateur, la validation ayant déjà
 * eu lieu avant la création de l'organisation.
 */
export async function attributeReferralByPromoCode(
  organizationId: string,
  validated: ValidatedPromoCode,
  newOrganizationOwnerUserId: string,
): Promise<void> {
  try {
    const supabase = getSupabaseServiceClient();
    const { data: referral, error } = await supabase
      .from("affiliate_referrals")
      .insert({
        organization_id: organizationId,
        affiliate_id: validated.affiliateId,
        link_id: validated.linkId,
        click_id: null,
        attribution_method: "promo_code",
      })
      .select("id")
      .single();

    if (error || !referral) {
      console.warn(`attributeReferralByPromoCode: échec insertion (org ${organizationId}):`, error?.message);
      return;
    }

    // Même heuristique (non bloquante) que attributeReferral() — voir
    // son commentaire pour le détail, dupliquée ici plutôt que
    // factorisée pour garder chaque fonction lisible indépendamment
    // (deux appelants différents, deux moments différents du flow).
    const { data: ownerMemberships } = await supabase
      .from("memberships")
      .select("organization_id")
      .eq("user_id", newOrganizationOwnerUserId)
      .eq("role", "owner");

    const otherOwnedOrgIds = (ownerMemberships ?? [])
      .map((m) => m.organization_id)
      .filter((id) => id !== organizationId);

    if (otherOwnedOrgIds.length > 0) {
      const { count: otherReferralsCount } = await supabase
        .from("affiliate_referrals")
        .select("id", { count: "exact", head: true })
        .in("organization_id", otherOwnedOrgIds);

      if ((otherReferralsCount ?? 0) > 0) {
        await supabase.from("affiliate_fraud_flags").insert({
          affiliate_id: validated.affiliateId,
          referral_id: referral.id,
          flag_type: "duplicate_organization_owner",
          severity: "low",
          details: { organizationId, ownerUserId: newOrganizationOwnerUserId },
        });
      }
    }
  } catch (err) {
    console.warn(`attributeReferralByPromoCode: erreur inattendue (org ${organizationId}):`, err);
  }
}

/**
 * Remise applicable sur le PROCHAIN paiement d'abonnement d'une
 * organisation, en points de base — non nulle uniquement si elle a été
 * référée par un code promo ET n'a encore jamais payé
 * (`conversions_count === 0`, même donnée que sequence_number ailleurs,
 * aucune colonne dédiée nécessaire). Appelée par
 * subscription-payment-service.ts::initiatePayment.
 */
export async function getPromoCodeDiscountBpsForNextPayment(organizationId: string): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { data: referral } = await supabase
    .from("affiliate_referrals")
    .select("attribution_method, conversions_count")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!referral || referral.attribution_method !== "promo_code" || referral.conversions_count > 0) {
    return 0;
  }
  return getPlatformSettingNumber("affiliate_promo_code_discount_bps", 1000);
}

// ------------------------------------------------------------
// Conversions (appelée depuis subscription-payment-service.ts::markPaymentCompleted)
// ------------------------------------------------------------

export interface CompletedSubscriptionPaymentForAffiliate {
  id: string;
  organizationId: string;
  amountFcfa: number;
  currencyCode: string;
}

/**
 * Best-effort par construction (voir contrat en tête de fichier) —
 * idempotent via la contrainte unique `affiliate_conversions.
 * subscription_payment_id` : un webhook rejoué ne génère jamais une
 * seconde commission pour le même paiement.
 */
export async function recordAffiliateConversion(payment: CompletedSubscriptionPaymentForAffiliate): Promise<void> {
  try {
    const supabase = getSupabaseServiceClient();

    const { data: referral, error: referralError } = await supabase
      .from("affiliate_referrals")
      .select("id, affiliate_id, link_id, conversions_count, status, attribution_method")
      .eq("organization_id", payment.organizationId)
      .maybeSingle();

    if (referralError || !referral) return; // organisation non référée — cas normal de la majorité des paiements.
    if (referral.status === "reversed") return; // référence désactivée manuellement par un admin.

    const sequenceNumber = referral.conversions_count + 1;
    const recurringMonths = await getPlatformSettingNumber("affiliate_recurring_months", 0);
    if (!isConversionEligible(sequenceNumber, recurringMonths)) return; // hors fenêtre de récurrence configurée.

    // Code promo (0052) : commission réduite, en contrepartie de la remise
    // déjà appliquée au client sur ce même paiement (voir
    // getPromoCodeDiscountBpsForNextPayment, subscription-payment-service.ts
    // ::initiatePayment) — payment.amountFcfa est déjà le montant NET,
    // donc ce taux s'applique de fait au prix déjà remisé, jamais au prix plein.
    const commissionRateBps =
      referral.attribution_method === "promo_code"
        ? await getPlatformSettingNumber("affiliate_promo_code_commission_rate_bps", 1000)
        : await getPlatformSettingNumber("affiliate_commission_rate_bps", 0);
    const commissionAmountFcfa = computeCommissionAmountFcfa(payment.amountFcfa, commissionRateBps);
    const holdPeriodDays = await getPlatformSettingNumber("affiliate_hold_period_days", 14);
    const now = new Date();

    const { data: conversion, error } = await supabase
      .from("affiliate_conversions")
      .insert({
        referral_id: referral.id,
        organization_id: payment.organizationId,
        affiliate_id: referral.affiliate_id,
        subscription_payment_id: payment.id,
        sequence_number: sequenceNumber,
        amount_fcfa: payment.amountFcfa,
        commission_rate_bps: commissionRateBps,
        commission_amount_fcfa: commissionAmountFcfa,
        currency_code: payment.currencyCode,
        status: "pending_hold",
        hold_release_at: computeHoldReleaseAt(now, holdPeriodDays).toISOString(),
      })
      .select("id")
      .single();

    if (error || !conversion) {
      if (error?.code === "23505") return; // déjà traité (webhook rejoué) — idempotence, silencieux.
      console.error(`recordAffiliateConversion: échec insertion (payment ${payment.id}):`, error?.message);
      return;
    }

    await supabase
      .from("affiliate_referrals")
      .update({
        conversions_count: sequenceNumber,
        status: "converted",
        first_converted_at: referral.conversions_count === 0 ? now.toISOString() : undefined,
        last_converted_at: now.toISOString(),
      })
      .eq("id", referral.id);

    if (referral.link_id) {
      await supabase.rpc("increment_affiliate_link_conversions", { p_link_id: referral.link_id });
    }

    await supabase.from("audit_logs").insert({
      organization_id: payment.organizationId,
      actor_user_id: null, // déclenché par le webhook de paiement, aucun acteur humain.
      action: "AFFILIATE_CONVERSION_RECORDED",
      entity_type: "affiliate_conversion",
      entity_id: conversion.id,
      after_state: { affiliateId: referral.affiliate_id, commissionAmountFcfa, sequenceNumber },
    });

    await notifyAffiliateTelegram(
      referral.affiliate_id,
      `🎉 Nouvelle commission : ${commissionAmountFcfa} ${payment.currencyCode} (paiement n°${sequenceNumber} de votre filleul). Elle sera disponible après la période de rétention.`,
    );
  } catch (err) {
    console.error(`recordAffiliateConversion: erreur inattendue (payment ${payment.id}):`, err);
  }
}

// ------------------------------------------------------------
// Cron — libération des commissions après la période de rétention
// ------------------------------------------------------------

export async function releaseExpiredAffiliateHolds(): Promise<{ approved: number; reversed: number }> {
  const supabase = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("affiliate_conversions")
    .select("id, subscription_payment_id")
    .eq("status", "pending_hold")
    .lte("hold_release_at", nowIso)
    .limit(500);

  if (error) throw new Error(`releaseExpiredAffiliateHolds: erreur lecture: ${error.message}`);

  let approved = 0;
  let reversed = 0;

  for (const row of due ?? []) {
    // Re-vérifie que le paiement source est TOUJOURS `completed` — un
    // remboursement/annulation survenu pendant la rétention doit
    // renverser la commission plutôt que la libérer (c'est la raison
    // d'être de cette période, voir docs/AFFILIATE_SYSTEM.md).
    const { data: payment } = await supabase
      .from("subscription_payments")
      .select("status")
      .eq("id", row.subscription_payment_id)
      .maybeSingle();

    const stillValid = payment?.status === "completed";

    const { error: updateError } = await supabase
      .from("affiliate_conversions")
      .update({ status: stillValid ? "approved" : "reversed" })
      .eq("id", row.id)
      .eq("status", "pending_hold"); // idempotence si le cron tourne deux fois en parallèle.

    if (updateError) {
      console.error(`releaseExpiredAffiliateHolds: échec mise à jour conversion ${row.id}:`, updateError.message);
      continue;
    }
    if (stillValid) approved++;
    else reversed++;
  }

  return { approved, reversed };
}

// ------------------------------------------------------------
// Statistiques (tableau de bord affilié)
// ------------------------------------------------------------

export interface AffiliateDashboardStats {
  totalClicks: number;
  totalReferrals: number;
  totalConversions: number;
  balance: AffiliateBalanceSummary;
}

export async function getAffiliateDashboardStats(affiliateId: string): Promise<AffiliateDashboardStats> {
  const supabase = getSupabaseServiceClient();

  const [clicksResult, referralsResult, conversionsResult] = await Promise.all([
    supabase.from("affiliate_clicks").select("id", { count: "exact", head: true }).eq("affiliate_id", affiliateId),
    supabase.from("affiliate_referrals").select("id", { count: "exact", head: true }).eq("affiliate_id", affiliateId),
    supabase.from("affiliate_conversions").select("status, commission_amount_fcfa").eq("affiliate_id", affiliateId),
  ]);

  const conversionRows = (conversionsResult.data ?? []).map((c) => ({
    status: c.status as ConversionStatus,
    commissionAmountFcfa: c.commission_amount_fcfa as number,
  }));

  return {
    totalClicks: clicksResult.count ?? 0,
    totalReferrals: referralsResult.count ?? 0,
    totalConversions: conversionRows.length,
    balance: summarizeBalance(conversionRows),
  };
}

export async function getAffiliateBalance(affiliateId: string): Promise<AffiliateBalanceSummary> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("affiliate_conversions")
    .select("status, commission_amount_fcfa")
    .eq("affiliate_id", affiliateId);

  if (error) throw new Error(`Erreur lecture affiliate_conversions: ${error.message}`);

  return summarizeBalance(
    (data ?? []).map((c) => ({ status: c.status as ConversionStatus, commissionAmountFcfa: c.commission_amount_fcfa as number })),
  );
}

// ------------------------------------------------------------
// Liaison Telegram (bot plateforme — indépendant de Zernio, voir
// docs/TELEGRAM_INTEGRATION.md et telegram-bot-service.ts)
// ------------------------------------------------------------

const TELEGRAM_LINK_TOKEN_TTL_MINUTES = 15;

/**
 * Génère un jeton de liaison à usage unique + le lien profond
 * `https://t.me/<bot>?start=<token>` à afficher sur
 * /affiliate/dashboard/telegram. Invalide toute tentative "pending"
 * précédente pour cet affilié avant d'en créer une nouvelle — évite
 * d'accumuler des jetons non utilisés (ex: l'affilié régénère le lien
 * après une première tentative abandonnée).
 */
export async function createAffiliateTelegramLinkToken(affiliateId: string): Promise<{ deepLink: string }> {
  if (!env.TELEGRAM_BOT_USERNAME) {
    throw new ValidationError("Le bot Telegram de la plateforme n'est pas encore configuré.");
  }

  const supabase = getSupabaseServiceClient();
  const token = randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TOKEN_TTL_MINUTES * 60_000).toISOString();

  await supabase
    .from("telegram_links")
    .delete()
    .eq("affiliate_id", affiliateId)
    .eq("purpose", "affiliate")
    .eq("status", "pending");

  const { error } = await supabase.from("telegram_links").insert({
    purpose: "affiliate",
    affiliate_id: affiliateId,
    link_token: token,
    link_token_expires_at: expiresAt,
  });
  if (error) throw new Error(`Impossible de générer le lien Telegram: ${error.message}`);

  return { deepLink: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${token}` };
}

export async function getAffiliateTelegramLinkStatus(
  affiliateId: string,
): Promise<{ linked: boolean; username: string | null }> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("telegram_links")
    .select("telegram_username")
    .eq("affiliate_id", affiliateId)
    .eq("purpose", "affiliate")
    .eq("status", "linked")
    .maybeSingle();

  return { linked: !!data, username: data?.telegram_username ?? null };
}
