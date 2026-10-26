import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { loadAlertSettings, raiseAlert } from "./alert-service";
import { thresholdFor } from "@/application/alerts/alert-policy";

/**
 * Remboursements de commandes clients (C2). Enregistrement atomique côté SQL
 * (`record_order_refund`, migration 0125) : le plafond cumulé et le statut « terminée » sont
 * contrôlés SOUS VERROU de la commande. Ce service n'est appelé qu'après l'approbation d'une carte
 * `sensitive` (outil `orders.refund`) — jamais directement depuis un message.
 */
export interface RecordRefundInput {
  organizationId: string;
  orderId: string;
  amount: number;
  reason: string;
  actorUserId: string;
  actorMembershipId: string;
}
export interface RefundResult { refundId: string; orderTotal: number; refundedTotal: number; currency: string; remaining: number }

type Db = SupabaseClient;
const money = (n: unknown) => Math.round(Number(n) * 100) / 100;

export async function recordOrderRefund(input: RecordRefundInput, db: Db = getSupabaseServiceClient()): Promise<RefundResult> {
  const { data, error } = await db.rpc("record_order_refund", {
    p_organization_id: input.organizationId, p_order_id: input.orderId, p_amount: input.amount,
    p_reason: input.reason, p_actor_user_id: input.actorUserId, p_actor_membership_id: input.actorMembershipId,
  });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("ORDER_NOT_FOUND") || (error as { code?: string }).code === "P0002") throw new NotFoundError("Commande introuvable.");
    if (m.includes("ORDER_NOT_COMPLETED")) throw new ValidationError("Seule une commande terminée peut être remboursée (une commande en attente s'annule).");
    if (m.includes("REFUND_EXCEEDS_TOTAL")) throw new ValidationError("Le montant dépasse ce qui reste remboursable sur cette commande.");
    if (m.includes("REFUND_AMOUNT_INVALID")) throw new ValidationError("Montant de remboursement invalide.");
    throw new Error(`Remboursement impossible: ${m}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { refund_id: string; order_total: number; refunded_total: number; currency: string } | null;
  if (!row) throw new Error("Remboursement: la fonction SQL n'a rien renvoyé.");
  return { refundId: row.refund_id, orderTotal: money(row.order_total), refundedTotal: money(row.refunded_total), currency: row.currency, remaining: money(Number(row.order_total) - Number(row.refunded_total)) };
}

/** Total déjà remboursé d'une commande de CET organisme (0 si aucun). */
export async function getRefundedTotal(organizationId: string, orderId: string, db: Db = getSupabaseServiceClient()): Promise<number> {
  const { data, error } = await db.from("order_refunds").select("amount").eq("organization_id", organizationId).eq("order_id", orderId);
  if (error) throw new Error(`Remboursements: lecture impossible: ${error.message}`);
  return money(((data ?? []) as { amount: number }[]).reduce((s, r) => s + Number(r.amount), 0));
}

/**
 * Seuil de remboursement choisi par le propriétaire (réglages d'alertes, déclencheur
 * `refund_over_threshold`). `undefined` = aucun seuil défini : aucune règle de seuil appliquée
 * (jamais de valeur par défaut en dur — le modèle de prix et les usages ne sont pas décidés).
 */
export async function getRefundThreshold(organizationId: string, db: Db = getSupabaseServiceClient()): Promise<number | undefined> {
  return thresholdFor(await loadAlertSettings(db, organizationId), "refund_over_threshold");
}

/** Alerte critique « remboursement au-dessus du seuil » (meilleur effort : ne casse jamais le remboursement déjà enregistré). */
export async function alertRefundOverThreshold(input: { organizationId: string; orderId: string; refundId: string; amount: number; currency: string; actorLabel?: string }): Promise<void> {
  try {
    await raiseAlert({
      organizationId: input.organizationId, trigger: "refund_over_threshold", value: input.amount,
      title: `Remboursement de ${input.amount.toLocaleString("fr-FR")} ${input.currency}`,
      body: `Commande ${input.orderId.slice(0, 8)}…${input.actorLabel ? ` — validé par ${input.actorLabel}` : ""}`,
      dedupeKey: `refund:${input.refundId}`,
    });
  } catch (error) {
    console.error("[order-refund] alerte de seuil non levée:", error instanceof Error ? error.message : error);
  }
}
