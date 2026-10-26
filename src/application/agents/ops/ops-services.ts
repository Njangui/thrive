import type { ListOrdersOptions, ListOrdersResult, OrderDetail, CreateOrderInput } from "@/application/services/order-service";
import type { CatalogProductSummary, ProductForEdit, UpdateProductInput } from "@/application/services/catalog-service";
import type { AppointmentListItem, AppointmentStatus, CreateAppointmentInput } from "@/application/services/appointment-service";
import type { CreateExpenseInput, CreateRevenueInput, FinanceEntry } from "@/application/services/finance-service";
import type { TenantFinancialOverview } from "@/application/services/tenant-finance-service";
import type { ContactMatch, LowStockItem } from "@/application/services/ops-lookup-service";
import type { RecordRefundInput, RefundResult } from "@/application/services/order-refund-service";

/**
 * Services existants que les outils Opérations enveloppent. Interface injectable : les outils ne
 * connaissent aucun client Supabase, et les tests les remplacent par des doublures.
 */
export interface OpsServices {
  listOrders(organizationId: string, options: ListOrdersOptions): Promise<ListOrdersResult>;
  getOrder(organizationId: string, orderId: string): Promise<OrderDetail>;
  createOrder(input: CreateOrderInput): Promise<{ orderId: string; total: number }>;
  completeOrder(organizationId: string, orderId: string, actorUserId?: string): Promise<void>;
  cancelOrder(organizationId: string, orderId: string): Promise<void>;
  /** Total déjà remboursé sur une commande (0 si aucun). */
  refundedTotal(organizationId: string, orderId: string): Promise<number>;
  /** Seuil de remboursement du propriétaire ; `undefined` = non défini. */
  refundThreshold(organizationId: string): Promise<number | undefined>;
  recordRefund(input: RecordRefundInput): Promise<RefundResult>;
  alertRefund(input: { organizationId: string; orderId: string; refundId: string; amount: number; currency: string }): Promise<void>;
  findProducts(organizationId: string, query: string, limit: number): Promise<CatalogProductSummary[]>;
  getProduct(organizationId: string, productId: string): Promise<ProductForEdit>;
  updateProduct(productId: string, organizationId: string, input: UpdateProductInput): Promise<void>;
  restock(organizationId: string, productId: string, quantity: number, actorUserId?: string): Promise<void>;
  decrement(organizationId: string, productId: string, quantity: number, reason: string, actorUserId?: string): Promise<void>;
  lowStock(organizationId: string, limit: number): Promise<LowStockItem[]>;
  findContacts(organizationId: string, query: string, limit: number): Promise<ContactMatch[]>;
  getContact(organizationId: string, contactId: string): Promise<ContactMatch | null>;
  listAppointments(organizationId: string): Promise<AppointmentListItem[]>;
  createAppointment(input: CreateAppointmentInput): Promise<{ appointmentId: string }>;
  setAppointmentStatus(appointmentId: string, organizationId: string, status: AppointmentStatus): Promise<void>;
  createExpense(input: CreateExpenseInput): Promise<{ expenseId: string }>;
  createRevenue(input: CreateRevenueInput): Promise<{ revenueId: string }>;
  recentFinance(organizationId: string, limit: number): Promise<FinanceEntry[]>;
  financialOverview(organizationId: string): Promise<TenantFinancialOverview>;
  /** Devise de l'entreprise (jamais déduite par le LLM). */
  currency(organizationId: string): Promise<string>;
}

/** Branchement par défaut sur les vrais services (import dynamique : modules chargés à la première utilisation). */
export function defaultOpsServices(): OpsServices {
  return {
    listOrders: async (o, opts) => (await import("@/application/services/order-service")).listOrdersForOrg(o, opts),
    getOrder: async (o, id) => (await import("@/application/services/order-service")).getOrderDetail(o, id),
    createOrder: async (i) => (await import("@/application/services/order-service")).createOrder(i),
    completeOrder: async (o, id, u) => (await import("@/application/services/order-service")).markOrderCompleted(o, id, u),
    cancelOrder: async (o, id) => (await import("@/application/services/order-service")).cancelOrder(o, id),
    refundedTotal: async (o, id) => (await import("@/application/services/order-refund-service")).getRefundedTotal(o, id),
    refundThreshold: async (o) => (await import("@/application/services/order-refund-service")).getRefundThreshold(o),
    recordRefund: async (i) => (await import("@/application/services/order-refund-service")).recordOrderRefund(i),
    alertRefund: async (i) => (await import("@/application/services/order-refund-service")).alertRefundOverThreshold(i),
    findProducts: async (o, q, l) => (await import("@/application/services/catalog-service")).searchProductsByName(o, q, l),
    getProduct: async (o, id) => (await import("@/application/services/catalog-service")).getProductForEdit(o, id),
    updateProduct: async (id, o, i) => (await import("@/application/services/catalog-service")).updateProduct(id, o, i),
    restock: async (o, id, q, u) => (await import("@/application/services/catalog-service")).restockProduct(o, id, q, u),
    decrement: async (o, id, q, r, u) => (await import("@/application/services/catalog-service")).decrementStock(o, id, q, r, u),
    lowStock: async (o, l) => (await import("@/application/services/ops-lookup-service")).listLowStock(o, l),
    findContacts: async (o, q, l) => (await import("@/application/services/ops-lookup-service")).findContacts(o, q, l),
    getContact: async (o, id) => (await import("@/application/services/ops-lookup-service")).getContact(o, id),
    listAppointments: async (o) => (await import("@/application/services/appointment-service")).listAppointments(o),
    createAppointment: async (i) => (await import("@/application/services/appointment-service")).createAppointment(i),
    setAppointmentStatus: async (id, o, s) => (await import("@/application/services/appointment-service")).updateAppointmentStatus(id, o, s),
    createExpense: async (i) => (await import("@/application/services/finance-service")).createExpense(i),
    createRevenue: async (i) => (await import("@/application/services/finance-service")).createRevenue(i),
    recentFinance: async (o, l) => (await import("@/application/services/finance-service")).listRecentFinanceEntries(o, l),
    financialOverview: async (o) => (await import("@/application/services/tenant-finance-service")).getTenantFinancialOverview(o),
    currency: async (o) => {
      const { getSupabaseServiceClient } = await import("@/infrastructure/supabase/server-client");
      const { data } = await getSupabaseServiceClient().from("organizations").select("currency").eq("id", o).maybeSingle();
      return (data as { currency?: string } | null)?.currency ?? "XAF";
    },
  };
}
