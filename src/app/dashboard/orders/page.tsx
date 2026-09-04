import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { listOrdersForOrg, ORDER_STATUSES, type OrderStatus } from "@/application/services/order-service";

const PAGE_SIZE = 50;

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  completed: "Terminée",
  cancelled: "Annulée",
};

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: "bg-ink/10 text-muted",
  confirmed: "bg-amber-500/10 text-amber-600",
  completed: "bg-leaf/10 text-leaf",
  cancelled: "bg-clay/10 text-clay",
};

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { page: pageParam, status: statusParam } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const page = Math.max(1, Number(pageParam) || 1);
  const status = statusParam && isOrderStatus(statusParam) ? statusParam : undefined;

  const { orders, totalCount } = await listOrdersForOrg(organizationId, { status, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Commandes</h1>
        <p className="mt-1 text-sm text-muted">Toutes les commandes de votre boutique.</p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Link href="/dashboard/orders" className={`rounded-full px-3 py-1 ${!status ? "bg-ink text-white" : "bg-ink/10 text-muted"}`}>
          Toutes
        </Link>
        {ORDER_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/dashboard/orders?status=${s}`}
            className={`rounded-full px-3 py-1 ${status === s ? "bg-ink text-white" : "bg-ink/10 text-muted"}`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-brand border border-ink/10 bg-white">
        {orders.length === 0 ? (
          <p className="p-6 text-sm text-muted">Aucune commande pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-2">
                    <p>{order.contactName ?? "Client anonyme"}</p>
                    <p className="text-xs text-muted">{order.contactPhone ?? "—"}</p>
                  </td>
                  <td className="px-4 py-2">
                    {order.totalAmount.toLocaleString("fr-FR")} {order.currency}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[order.status]}`}>
                      {STATUS_LABELS[order.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted">{new Date(order.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/dashboard/orders/${order.id}`} className="text-xs font-medium text-leaf hover:underline">
                      Détail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <p>
            Page {page} sur {totalPages} — {totalCount} commande{totalCount > 1 ? "s" : ""} au total
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/dashboard/orders?page=${page - 1}${status ? `&status=${status}` : ""}`}
                className="rounded-brand border border-ink/15 px-3 py-1.5 font-medium hover:border-ink/30"
              >
                Précédent
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/dashboard/orders?page=${page + 1}${status ? `&status=${status}` : ""}`}
                className="rounded-brand border border-ink/15 px-3 py-1.5 font-medium hover:border-ink/30"
              >
                Suivant
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
