import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { writeAdminAuditLog } from "./admin-organizations-service";
import { getPlatformSettingNumber } from "./platform-settings-service";
import type { AffiliateStatus, FraudSeverity } from "@/domain/entities/affiliate";

/**
 * Console Super Admin du programme d'affiliation (/admin/affiliates/*).
 * Même garde d'accès que le reste de `/admin` — `requirePlatformAdmin()`
 * est appelée par les Server Actions/pages qui consomment ce fichier,
 * jamais ici (ce service reste un pur accès-données, comme
 * `admin-organizations-service.ts`).
 */

export interface AffiliateAdminSummary {
  id: string;
  displayName: string;
  contactEmail: string;
  status: AffiliateStatus;
  appliedAt: string;
  approvedAt: string | null;
  totalConversions: number;
  availableBalanceFcfa: number;
}

export async function listAffiliates(filter?: { status?: AffiliateStatus }): Promise<AffiliateAdminSummary[]> {
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("affiliates")
    .select("id, display_name, contact_email, status, applied_at, approved_at")
    .order("applied_at", { ascending: false });

  if (filter?.status) query = query.eq("status", filter.status);

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture affiliates: ${error.message}`);
  if (!data || data.length === 0) return [];

  const ids = data.map((a) => a.id);
  const { data: conversions } = await supabase
    .from("affiliate_conversions")
    .select("affiliate_id, status, commission_amount_fcfa")
    .in("affiliate_id", ids);

  const statsByAffiliate = new Map<string, { total: number; available: number }>();
  for (const c of conversions ?? []) {
    const entry = statsByAffiliate.get(c.affiliate_id) ?? { total: 0, available: 0 };
    entry.total += 1;
    if (c.status === "approved") entry.available += c.commission_amount_fcfa as number;
    statsByAffiliate.set(c.affiliate_id, entry);
  }

  return data.map((a) => {
    const stats = statsByAffiliate.get(a.id) ?? { total: 0, available: 0 };
    return {
      id: a.id,
      displayName: a.display_name,
      contactEmail: a.contact_email,
      status: a.status as AffiliateStatus,
      appliedAt: a.applied_at,
      approvedAt: a.approved_at,
      totalConversions: stats.total,
      availableBalanceFcfa: stats.available,
    };
  });
}

export interface AffiliateAdminDetail extends AffiliateAdminSummary {
  phone: string | null;
  promotionChannels: string | null;
  payoutMethod: unknown;
  notes: string | null;
  rejectionReason: string | null;
}

export async function getAffiliateDetail(affiliateId: string): Promise<AffiliateAdminDetail> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("affiliates").select("*").eq("id", affiliateId).maybeSingle();

  if (error) throw new Error(`Erreur lecture affiliate: ${error.message}`);
  if (!data) throw new NotFoundError("Affilié introuvable.");

  const { data: conversions } = await supabase
    .from("affiliate_conversions")
    .select("status, commission_amount_fcfa")
    .eq("affiliate_id", affiliateId);

  const availableBalanceFcfa = (conversions ?? [])
    .filter((c) => c.status === "approved")
    .reduce((sum, c) => sum + (c.commission_amount_fcfa as number), 0);

  return {
    id: data.id,
    displayName: data.display_name,
    contactEmail: data.contact_email,
    status: data.status as AffiliateStatus,
    appliedAt: data.applied_at,
    approvedAt: data.approved_at,
    totalConversions: (conversions ?? []).length,
    availableBalanceFcfa,
    phone: data.phone,
    promotionChannels: data.promotion_channels,
    payoutMethod: data.payout_method,
    notes: data.notes,
    rejectionReason: data.rejection_reason,
  };
}

export async function approveAffiliate(affiliateId: string, adminUserId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("affiliates")
    .update({ status: "active", approved_at: new Date().toISOString(), approved_by: adminUserId })
    .eq("id", affiliateId)
    .eq("status", "pending")
    .select("id, user_id, display_name")
    .maybeSingle();

  if (error) throw new Error(`Impossible d'approuver l'affilié: ${error.message}`);
  if (!data) throw new NotFoundError("Candidature introuvable ou déjà traitée.");

  await writeAdminAuditLog({
    actorUserId: adminUserId,
    organizationId: null,
    action: "AFFILIATE_APPROVED",
    entityType: "affiliate",
    entityId: affiliateId,
  });
}

export async function rejectAffiliate(affiliateId: string, adminUserId: string, reason: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("affiliates")
    .update({ status: "rejected", rejection_reason: reason.trim().slice(0, 1000) })
    .eq("id", affiliateId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Impossible de refuser la candidature: ${error.message}`);
  if (!data) throw new NotFoundError("Candidature introuvable ou déjà traitée.");

  await writeAdminAuditLog({
    actorUserId: adminUserId,
    organizationId: null,
    action: "AFFILIATE_REJECTED",
    entityType: "affiliate",
    entityId: affiliateId,
    afterState: { reason },
  });
}

export async function suspendAffiliate(affiliateId: string, adminUserId: string, reason?: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("affiliates")
    .update({ status: "suspended", suspended_at: new Date().toISOString(), notes: reason?.trim().slice(0, 1000) ?? null })
    .eq("id", affiliateId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Impossible de suspendre l'affilié: ${error.message}`);
  if (!data) throw new NotFoundError("Affilié introuvable ou déjà non-actif.");

  await writeAdminAuditLog({
    actorUserId: adminUserId,
    organizationId: null,
    action: "AFFILIATE_SUSPENDED",
    entityType: "affiliate",
    entityId: affiliateId,
    afterState: { reason },
  });
}

export async function reactivateAffiliate(affiliateId: string, adminUserId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("affiliates")
    .update({ status: "active", suspended_at: null })
    .eq("id", affiliateId)
    .eq("status", "suspended")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Impossible de réactiver l'affilié: ${error.message}`);
  if (!data) throw new NotFoundError("Affilié introuvable ou pas suspendu.");

  await writeAdminAuditLog({
    actorUserId: adminUserId,
    organizationId: null,
    action: "AFFILIATE_REACTIVATED",
    entityType: "affiliate",
    entityId: affiliateId,
  });
}

// ------------------------------------------------------------
// File de revue anti-fraude
// ------------------------------------------------------------

export interface FraudFlagSummary {
  id: string;
  affiliateId: string | null;
  affiliateDisplayName: string | null;
  flagType: string;
  severity: FraudSeverity;
  details: unknown;
  status: "open" | "reviewed" | "dismissed";
  createdAt: string;
}

export async function listFraudFlags(status: "open" | "reviewed" | "dismissed" = "open"): Promise<FraudFlagSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("affiliate_fraud_flags")
    .select("id, affiliate_id, flag_type, severity, details, status, created_at, affiliates(display_name)")
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Erreur lecture affiliate_fraud_flags: ${error.message}`);

  return (data ?? []).map((row) => {
    const r = row as typeof row & { affiliates?: { display_name?: string } };
    return {
      id: r.id,
      affiliateId: r.affiliate_id,
      affiliateDisplayName: r.affiliates?.display_name ?? null,
      flagType: r.flag_type,
      severity: r.severity as FraudSeverity,
      details: r.details,
      status: r.status as "open" | "reviewed" | "dismissed",
      createdAt: r.created_at,
    };
  });
}

export async function reviewFraudFlag(
  flagId: string,
  adminUserId: string,
  outcome: "reviewed" | "dismissed",
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("affiliate_fraud_flags")
    .update({ status: outcome, reviewed_by: adminUserId, reviewed_at: new Date().toISOString() })
    .eq("id", flagId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Impossible de mettre à jour le signalement: ${error.message}`);
  if (!data) throw new NotFoundError("Signalement introuvable ou déjà traité.");

  await writeAdminAuditLog({
    actorUserId: adminUserId,
    organizationId: null,
    action: outcome === "reviewed" ? "AFFILIATE_FRAUD_FLAG_REVIEWED" : "AFFILIATE_FRAUD_FLAG_DISMISSED",
    entityType: "affiliate_fraud_flag",
    entityId: flagId,
  });
}

// ------------------------------------------------------------
// Réglages du programme
// ------------------------------------------------------------

export interface AffiliateProgramSettings {
  commissionRateBps: number;
  recurringMonths: number;
  cookieWindowDays: number;
  holdPeriodDays: number;
  minPayoutFcfa: number;
  promoCodeCommissionRateBps: number;
  promoCodeDiscountBps: number;
}

export async function getAffiliateProgramSettings(): Promise<AffiliateProgramSettings> {
  const [
    commissionRateBps,
    recurringMonths,
    cookieWindowDays,
    holdPeriodDays,
    minPayoutFcfa,
    promoCodeCommissionRateBps,
    promoCodeDiscountBps,
  ] = await Promise.all([
    getPlatformSettingNumber("affiliate_commission_rate_bps", 2000),
    getPlatformSettingNumber("affiliate_recurring_months", 0),
    getPlatformSettingNumber("affiliate_cookie_window_days", 30),
    getPlatformSettingNumber("affiliate_hold_period_days", 14),
    getPlatformSettingNumber("affiliate_min_payout_fcfa", 10000),
    getPlatformSettingNumber("affiliate_promo_code_commission_rate_bps", 1000),
    getPlatformSettingNumber("affiliate_promo_code_discount_bps", 1000),
  ]);
  return {
    commissionRateBps,
    recurringMonths,
    cookieWindowDays,
    holdPeriodDays,
    minPayoutFcfa,
    promoCodeCommissionRateBps,
    promoCodeDiscountBps,
  };
}

/**
 * N'utilise PAS `platform-settings-service.ts::setPlatformSetting` :
 * cette fonction partagée rejette toute valeur négative
 * (`value < 0`), ce qui est correct pour ses réglages existants mais
 * empêcherait `affiliate_recurring_months = -1` (commission à vie,
 * valeur légitime — voir domain/entities/affiliate.ts::
 * isConversionEligible). Plutôt que d'assouplir une validation partagée
 * pour un seul cas particulier, ce service écrit directement avec SES
 * PROPRES bornes, en conservant la même discipline d'audit
 * (writeAdminAuditLog systématique).
 */
export async function updateAffiliateProgramSettings(
  input: Partial<AffiliateProgramSettings>,
  adminUserId: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const entries: [string, number][] = [];

  if (input.commissionRateBps !== undefined) {
    if (!Number.isInteger(input.commissionRateBps) || input.commissionRateBps < 0 || input.commissionRateBps > 10000) {
      throw new ValidationError("Le taux de commission doit être un entier entre 0 et 10000 points de base.");
    }
    entries.push(["affiliate_commission_rate_bps", input.commissionRateBps]);
  }
  if (input.recurringMonths !== undefined) {
    if (!Number.isInteger(input.recurringMonths) || input.recurringMonths < -1) {
      throw new ValidationError("Les renouvellements commissionnés doivent être -1 (à vie) ou un entier >= 0.");
    }
    entries.push(["affiliate_recurring_months", input.recurringMonths]);
  }
  if (input.cookieWindowDays !== undefined) {
    if (!Number.isInteger(input.cookieWindowDays) || input.cookieWindowDays < 1) {
      throw new ValidationError("La fenêtre d'attribution doit être un entier >= 1 jour.");
    }
    entries.push(["affiliate_cookie_window_days", input.cookieWindowDays]);
  }
  if (input.holdPeriodDays !== undefined) {
    if (!Number.isInteger(input.holdPeriodDays) || input.holdPeriodDays < 0) {
      throw new ValidationError("La période de rétention doit être un entier >= 0 jour.");
    }
    entries.push(["affiliate_hold_period_days", input.holdPeriodDays]);
  }
  if (input.minPayoutFcfa !== undefined) {
    if (!Number.isInteger(input.minPayoutFcfa) || input.minPayoutFcfa < 0) {
      throw new ValidationError("Le seuil minimum de paiement doit être un entier positif.");
    }
    entries.push(["affiliate_min_payout_fcfa", input.minPayoutFcfa]);
  }
  if (input.promoCodeCommissionRateBps !== undefined) {
    if (
      !Number.isInteger(input.promoCodeCommissionRateBps) ||
      input.promoCodeCommissionRateBps < 0 ||
      input.promoCodeCommissionRateBps > 10000
    ) {
      throw new ValidationError("Le taux de commission (code promo) doit être un entier entre 0 et 10000 points de base.");
    }
    entries.push(["affiliate_promo_code_commission_rate_bps", input.promoCodeCommissionRateBps]);
  }
  if (input.promoCodeDiscountBps !== undefined) {
    if (
      !Number.isInteger(input.promoCodeDiscountBps) ||
      input.promoCodeDiscountBps < 0 ||
      input.promoCodeDiscountBps > 10000
    ) {
      throw new ValidationError("La remise client (code promo) doit être un entier entre 0 et 10000 points de base.");
    }
    entries.push(["affiliate_promo_code_discount_bps", input.promoCodeDiscountBps]);
  }

  for (const [key, value] of entries) {
    const { error } = await supabase.from("platform_settings").upsert({ key, value }, { onConflict: "key" });
    if (error) throw new Error(`Impossible d'écrire le réglage "${key}": ${error.message}`);
  }

  if (entries.length > 0) {
    await writeAdminAuditLog({
      actorUserId: adminUserId,
      organizationId: null,
      action: "AFFILIATE_PROGRAM_SETTINGS_CHANGED",
      entityType: "platform_setting",
      afterState: Object.fromEntries(entries),
    });
  }
}

