import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { decrementStock } from "./catalog-service";
import { notifyOrgAdmins } from "./notification-service";
import { trackEvent } from "./analytics-service";

export interface CreateOrderItemInput {
  productId: string;
  label: string;
  unitPrice: number;
  quantity: number;
}

export interface CreateOrderInput {
  organizationId: string;
  contactId: string;
  leadId?: string;
  items: CreateOrderItemInput[];
  notes?: string;
}

export async function createOrder(input: CreateOrderInput): Promise<{ orderId: string; total: number }> {
  const supabase = getSupabaseServiceClient();
  const total = input.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      organization_id: input.organizationId,
      contact_id: input.contactId,
      lead_id: input.leadId ?? null,
      status: "pending",
      total_amount: total,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    throw new Error(`Impossible de créer la commande: ${orderError?.message}`);
  }

  const { error: itemsError } = await supabase.from("order_items").insert(
    input.items.map((item) => ({
      organization_id: input.organizationId,
      order_id: order.id,
      product_id: item.productId,
      label: item.label,
      unit_price: item.unitPrice,
      quantity: item.quantity,
    })),
  );

  if (itemsError) {
    throw new Error(`Impossible d'enregistrer les articles de la commande ${order.id}: ${itemsError.message}`);
  }

  await notifyOrgAdmins({
    organizationId: input.organizationId,
    title: "Nouvelle commande.",
    body: `Commande de ${total.toLocaleString("fr-FR")} FCFA reçue.`,
    relatedEntityType: "order",
    relatedEntityId: order.id,
  });

  // Lot H, Partie 2 (master prompt §55) — à la création de la commande,
  // pas à sa complétion (markOrderCompleted a un autre rôle : générer un
  // revenu, pas re-tracker le même événement).
  await trackEvent(input.organizationId, "order_created", "order", order.id, { total });

  return { orderId: order.id, total };
}

/**
 * Complète une commande (section 58, étapes 20-23) :
 *  1. status -> completed
 *  2. décrément de stock par article (bascule OUT_OF_STOCK si nécessaire)
 *  3. entrée `revenues` automatique (section 27 : Order -> Revenue)
 *
 * Logique en couche application plutôt qu'un trigger DB, pour rester
 * explicite, testable, et éviter un effet de bord invisible en lisant
 * juste le schéma (section 43 : error handling clair par étape).
 */
export async function markOrderCompleted(
  organizationId: string,
  orderId: string,
  actorUserId?: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, total_amount, currency")
    .eq("id", orderId)
    .eq("organization_id", organizationId)
    .single();

  if (orderError || !order) {
    throw new Error(`Commande introuvable: ${orderId}`);
  }
  if (order.status === "completed") return; // idempotent — pas de double comptage

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("product_id, quantity, label")
    .eq("order_id", orderId);

  if (itemsError) {
    throw new Error(`Impossible de lire les articles de la commande ${orderId}: ${itemsError.message}`);
  }

  for (const item of items ?? []) {
    if (!item.product_id) continue; // article libre non catalogué — pas de décrément
    await decrementStock(
      organizationId,
      item.product_id,
      Number(item.quantity),
      `Vente — commande ${orderId}`,
      actorUserId,
    );
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "completed" })
    .eq("id", orderId);

  if (updateError) {
    throw new Error(`Impossible de finaliser la commande ${orderId}: ${updateError.message}`);
  }

  await supabase.from("revenues").insert({
    organization_id: organizationId,
    order_id: orderId,
    amount: order.total_amount,
    currency: order.currency,
    category: "vente",
    source: "order",
    reference: orderId,
    created_by: actorUserId,
  });
}

export async function cancelOrder(organizationId: string, orderId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", orderId)
    .eq("organization_id", organizationId)
    .neq("status", "completed"); // on ne annule pas une commande déjà finalisée

  if (error) {
    throw new Error(`Impossible d'annuler la commande ${orderId}: ${error.message}`);
  }
}
