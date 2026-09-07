import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { pauseScheduledPostsForProduct } from "./marketing-service";
import { notifyOrgAdmins } from "./notification-service";
import { trackEvent } from "./analytics-service";
import { NotFoundError } from "@/lib/errors";

/** Statuts réels — `orders_status_check` (0009_align_orders_status.sql). */
export const ORDER_STATUSES = ["pending", "confirmed", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Forme de retour de `complete_order_transaction()` — voir 0038_atomic_order_stock_transaction.sql. */
interface CompleteOrderTransactionRow {
  already_completed: boolean;
  result_order_id: string;
  total_amount: number;
  currency: string;
  newly_out_of_stock_product_ids: string[] | null;
}


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
 * Lot 1 (audit sécurité/DB/stock) — ces trois étapes passent maintenant
 * par `complete_order_transaction()`, une fonction SQL unique exécutée
 * dans UNE seule transaction Postgres avec verrouillage de ligne (`FOR
 * UPDATE` sur `orders` ET sur chaque `products` décrémenté) — voir
 * migration 0038_atomic_order_stock_transaction.sql pour le détail et le
 * bug réel que ça corrige (double complétion / double décrément sous
 * appels concurrents, section 19/71 du master prompt). Ce n'est PLUS une
 * suite d'appels Supabase séparés : soit tout est appliqué, soit rien ne
 * l'est (rollback automatique sur erreur SQL).
 *
 * Les effets de bord qui ne sont PAS des mutations de données (notifier
 * les admins, mettre en pause des publications programmées) restent ici,
 * déclenchés APRÈS le commit de la transaction, pour chaque produit que
 * la fonction SQL signale comme venant de basculer en rupture — jamais
 * dans le SQL lui-même (ces appels touchent d'autres services/tables
 * sans lien avec l'atomicité stock/commande/revenu).
 */
export async function markOrderCompleted(
  organizationId: string,
  orderId: string,
  actorUserId?: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase.rpc("complete_order_transaction", {
    p_order_id: orderId,
    p_organization_id: organizationId,
    p_actor_user_id: actorUserId ?? null,
  });

  if (error) {
    // P0002 = "no_data_found" côté Postgres, levé explicitement par la
    // fonction SQL quand la commande n'existe pas pour cette organisation
    // (défense en profondeur IDOR — jamais faire confiance à orderId sans
    // vérifier organizationId, section 70).
    if (error.code === "P0002") {
      throw new Error(`Commande introuvable: ${orderId}`);
    }
    throw new Error(`Impossible de finaliser la commande ${orderId}: ${error.message}`);
  }

  const result = (data as CompleteOrderTransactionRow[] | null)?.[0];
  if (!result) {
    throw new Error(`Commande introuvable: ${orderId}`);
  }
  if (result.already_completed) return; // idempotent — pas de double comptage, pas de double notification

  for (const productId of result.newly_out_of_stock_product_ids ?? []) {
    await pauseScheduledPostsForProduct(organizationId, productId);

    const { data: product } = await supabase
      .from("products")
      .select("name")
      .eq("id", productId)
      .maybeSingle();

    await notifyOrgAdmins({
      organizationId,
      title: "Produit en rupture de stock.",
      body: `Le produit "${product?.name ?? productId}" est en rupture de stock.`,
      relatedEntityType: "product",
      relatedEntityId: productId,
    });
  }
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

// ---------------------------------------------------------------------------
// Lot L, Partie 3 — écran /dashboard/orders (lecture paginée + détail)
// ---------------------------------------------------------------------------

export interface OrderListItem {
  id: string;
  status: OrderStatus;
  totalAmount: number;
  currency: string;
  createdAt: string;
  contactName: string | null;
  contactPhone: string | null;
}

export interface ListOrdersOptions {
  status?: OrderStatus;
  page: number;
  pageSize: number;
}

export interface ListOrdersResult {
  orders: OrderListItem[];
  totalCount: number;
}

interface OrderRow {
  id: string;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
  contacts?: { full_name?: string | null; phone_e164?: string | null } | null;
}

/** Pagination `.range()` — même convention que products/page.tsx et lead-service.ts::listLeadsForOrg. */
export async function listOrdersForOrg(organizationId: string, options: ListOrdersOptions): Promise<ListOrdersResult> {
  const supabase = getSupabaseServiceClient();
  const from = (options.page - 1) * options.pageSize;
  const to = from + options.pageSize - 1;

  let query = supabase
    .from("orders")
    .select("id, status, total_amount, currency, created_at, contacts(full_name, phone_e164)", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (options.status) {
    query = query.eq("status", options.status);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`Erreur lecture des commandes: ${error.message}`);

  const rows = (data ?? []) as unknown as OrderRow[];
  return {
    orders: rows.map((row) => ({
      id: row.id,
      status: row.status as OrderStatus,
      totalAmount: Number(row.total_amount),
      currency: row.currency,
      createdAt: row.created_at,
      contactName: row.contacts?.full_name ?? null,
      contactPhone: row.contacts?.phone_e164 ?? null,
    })),
    totalCount: count ?? 0,
  };
}

export interface OrderDetail extends OrderListItem {
  notes: string | null;
  items: { id: string; label: string; unitPrice: number; quantity: number }[];
}

/** Détail d'une commande (cahier UI : "clic vers un détail (order_items, total, client)"). */
export async function getOrderDetail(organizationId: string, orderId: string): Promise<OrderDetail> {
  const supabase = getSupabaseServiceClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, total_amount, currency, notes, created_at, contacts(full_name, phone_e164)")
    .eq("id", orderId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (orderError) throw new Error(`Erreur lecture commande: ${orderError.message}`);
  if (!order) throw new NotFoundError("Commande introuvable.");

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("id, label, unit_price, quantity")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (itemsError) throw new Error(`Erreur lecture des articles: ${itemsError.message}`);

  const contact = (order as unknown as { contacts?: { full_name?: string | null; phone_e164?: string | null } })
    .contacts;

  return {
    id: order.id,
    status: order.status as OrderStatus,
    totalAmount: Number(order.total_amount),
    currency: order.currency,
    notes: order.notes,
    createdAt: order.created_at,
    contactName: contact?.full_name ?? null,
    contactPhone: contact?.phone_e164 ?? null,
    items: (items ?? []).map((item) => ({
      id: item.id,
      label: item.label,
      unitPrice: Number(item.unit_price),
      quantity: Number(item.quantity),
    })),
  };
}
