import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { canRequestPayout } from "@/domain/entities/affiliate";
import { getAffiliateBalance } from "./affiliate-service";
import { getPlatformSettingNumber } from "./platform-settings-service";
import { writeAdminAuditLog } from "./admin-organizations-service";
import { notifyPlatformAdminTelegram } from "./telegram-admin-notification-service";

/**
 * Paiement de commission = virement MANUEL (mobile money/bancaire) — ce
 * service ne fait jamais transiter d'argent lui-même : il trace la
 * demande, laisse un opérateur l'exécuter hors-bande, puis enregistre la
 * référence. Choix délibérément conservé lors de la migration NotchPay ->
 * Fapshi (2026-09-20) : Fapshi expose bien une API `/payout` (contrairement
 * à NotchPay, qui n'en avait aucune dans ce projet — voir
 * docs/AFFILIATE_SYSTEM.md pour le contexte historique), mais l'activer
 * exigerait un second compte de service Fapshi dédié rien qu'aux payouts
 * (Fapshi interdit de mélanger collecte et payout sur un même compte) —
 * décision produit qui reste à prendre, hors périmètre de cette
 * migration. Cette fonction automatiserait alors l'appel plutôt que de
 * changer d'approche.
 */

export interface AffiliatePayoutSummary {
  id: string;
  affiliateId: string;
  amountFcfa: number;
  currencyCode: string;
  status: "requested" | "approved" | "rejected" | "paid";
  adminNotes: string | null;
  paymentReference: string | null;
  requestedAt: string;
  processedAt: string | null;
}

interface PayoutRow {
  id: string;
  affiliate_id: string;
  amount_fcfa: number;
  currency_code: string;
  status: "requested" | "approved" | "rejected" | "paid";
  admin_notes: string | null;
  payment_reference: string | null;
  requested_at: string;
  processed_at: string | null;
}

function mapPayoutRow(row: PayoutRow): AffiliatePayoutSummary {
  return {
    id: row.id,
    affiliateId: row.affiliate_id,
    amountFcfa: row.amount_fcfa,
    currencyCode: row.currency_code,
    status: row.status,
    adminNotes: row.admin_notes,
    paymentReference: row.payment_reference,
    requestedAt: row.requested_at,
    processedAt: row.processed_at,
  };
}

const PAYOUT_SELECT =
  "id, affiliate_id, amount_fcfa, currency_code, status, admin_notes, payment_reference, requested_at, processed_at";

/**
 * Vérifie le seuil minimum (message clair côté formulaire) PUIS délègue
 * la sélection/verrouillage réel des commissions à
 * `request_affiliate_payout` (0047_affiliate_payout_atomic.sql) — cette
 * vérification préalable est un confort UX, pas la garde de sécurité
 * réelle (qui vit en base, atomique, voir la fonction SQL).
 */
export async function requestPayout(affiliateId: string): Promise<AffiliatePayoutSummary> {
  const supabase = getSupabaseServiceClient();

  const { data: affiliate, error: affiliateError } = await supabase
    .from("affiliates")
    .select("payout_method")
    .eq("id", affiliateId)
    .single();

  if (affiliateError || !affiliate) throw new NotFoundError("Affilié introuvable.");
  if (!affiliate.payout_method) {
    throw new ValidationError("Renseignez d'abord votre méthode de paiement (mobile money ou virement bancaire).");
  }

  const [balance, minPayoutFcfa] = await Promise.all([
    getAffiliateBalance(affiliateId),
    getPlatformSettingNumber("affiliate_min_payout_fcfa", 10000),
  ]);

  if (!canRequestPayout(balance.availableFcfa, minPayoutFcfa)) {
    throw new ValidationError(
      `Solde disponible insuffisant (${balance.availableFcfa} FCFA). Le minimum pour une demande de paiement est de ${minPayoutFcfa} FCFA.`,
    );
  }

  const { data, error } = await supabase.rpc("request_affiliate_payout", {
    p_affiliate_id: affiliateId,
    p_payout_method: affiliate.payout_method,
  });

  if (error) {
    if (error.message.includes("no_payable_balance")) {
      throw new ValidationError("Aucune commission approuvée disponible pour le moment — réessayez plus tard.");
    }
    throw new Error(`Impossible de créer la demande de paiement: ${error.message}`);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error("Réponse inattendue de request_affiliate_payout.");

  await notifyPlatformAdminTelegram("AFFILIATE_PAYOUT_REQUESTED", {
    entityType: "affiliate_payout",
    entityId: result.payout_id,
    details: { montant: `${result.amount_fcfa} ${result.currency_code}` },
  });

  const { data: created, error: fetchError } = await supabase
    .from("affiliate_payouts")
    .select(PAYOUT_SELECT)
    .eq("id", result.payout_id)
    .single();

  if (fetchError || !created) throw new Error("Demande créée mais impossible de la relire immédiatement.");
  return mapPayoutRow(created as PayoutRow);
}

export async function listAffiliatePayouts(affiliateId: string): Promise<AffiliatePayoutSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("affiliate_payouts")
    .select(PAYOUT_SELECT)
    .eq("affiliate_id", affiliateId)
    .order("requested_at", { ascending: false });

  if (error) throw new Error(`Erreur lecture affiliate_payouts: ${error.message}`);
  return (data ?? []).map((row) => mapPayoutRow(row as PayoutRow));
}

// ------------------------------------------------------------
// Vue admin — file de traitement des paiements
// ------------------------------------------------------------

export async function listPendingPayouts(): Promise<(AffiliatePayoutSummary & { affiliateDisplayName: string })[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("affiliate_payouts")
    .select(`${PAYOUT_SELECT}, affiliates(display_name)`)
    .in("status", ["requested", "approved"])
    .order("requested_at", { ascending: true });

  if (error) throw new Error(`Erreur lecture file de paiements: ${error.message}`);

  return (data ?? []).map((row) => {
    const r = row as PayoutRow & { affiliates?: { display_name?: string } };
    return { ...mapPayoutRow(r), affiliateDisplayName: r.affiliates?.display_name ?? "—" };
  });
}

/**
 * Marque une demande comme effectivement virée. Passe TOUTES ses
 * commissions couvertes (`affiliate_payout_items`) à `status='paid'` —
 * elles quittent définitivement le solde "disponible" (voir
 * summarizeBalance, domain/entities/affiliate.ts).
 */
export async function markPayoutPaid(payoutId: string, adminUserId: string, paymentReference: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: payout, error } = await supabase
    .from("affiliate_payouts")
    .update({ status: "paid", processed_at: new Date().toISOString(), processed_by: adminUserId, payment_reference: paymentReference })
    .eq("id", payoutId)
    .in("status", ["requested", "approved"])
    .select("id, affiliate_id, amount_fcfa")
    .maybeSingle();

  if (error) throw new Error(`Impossible de marquer le paiement comme effectué: ${error.message}`);
  if (!payout) throw new NotFoundError("Demande de paiement introuvable ou déjà traitée.");

  const { data: items } = await supabase.from("affiliate_payout_items").select("conversion_id").eq("payout_id", payoutId);
  const conversionIds = (items ?? []).map((i) => i.conversion_id);
  if (conversionIds.length > 0) {
    await supabase.from("affiliate_conversions").update({ status: "paid" }).in("id", conversionIds);
  }

  await writeAdminAuditLog({
    actorUserId: adminUserId,
    organizationId: null,
    action: "AFFILIATE_PAYOUT_PAID",
    entityType: "affiliate_payout",
    entityId: payoutId,
    afterState: { amountFcfa: payout.amount_fcfa, paymentReference },
  });
}

/**
 * Rejette une demande — DÉTACHE ses commissions (supprime les lignes
 * `affiliate_payout_items` correspondantes) pour qu'elles redeviennent
 * éligibles à une future demande (voir la clause `not exists` de
 * `request_affiliate_payout`, 0047_affiliate_payout_atomic.sql) : un
 * rejet (ex: RIB erroné signalé par l'affilié) ne doit jamais bloquer
 * ces commissions indéfiniment.
 */
export async function rejectPayout(payoutId: string, adminUserId: string, reason: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { error: deleteItemsError } = await supabase.from("affiliate_payout_items").delete().eq("payout_id", payoutId);
  if (deleteItemsError) throw new Error(`Impossible de détacher les commissions: ${deleteItemsError.message}`);

  const { data: payout, error } = await supabase
    .from("affiliate_payouts")
    .update({ status: "rejected", admin_notes: reason, processed_at: new Date().toISOString(), processed_by: adminUserId })
    .eq("id", payoutId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Impossible de rejeter la demande: ${error.message}`);
  if (!payout) throw new NotFoundError("Demande de paiement introuvable.");

  await writeAdminAuditLog({
    actorUserId: adminUserId,
    organizationId: null,
    action: "AFFILIATE_PAYOUT_REJECTED",
    entityType: "affiliate_payout",
    entityId: payoutId,
    afterState: { reason },
  });
}
