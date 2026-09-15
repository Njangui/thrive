import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { listOrdersForOrg, ORDER_STATUSES, type OrderStatus } from "@/application/services/order-service";
import { ORDER_STATUS_LABELS as STATUS_LABELS, ORDER_STATUS_STYLES as STATUS_STYLES } from "../_components/order-status";

const PAGE_SIZE = 50;

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
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Commandes</h1>
        <p className="mt-1 text-sm text-slate-500">Toutes les commandes de votre boutique.</p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Link href="/dashboard/orders" className={`rounded-full px-3 py-1 ${!status ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-600"}`}>
          Toutes
        </Link>
        {ORDER_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/dashboard/orders?status=${s}`}
            className={`rounded-full px-3 py-1 ${status === s ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)]">
        {orders.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Aucune commande pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-navy-900/10 text-left text-xs uppercase text-slate-500">
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
                <tr key={order.id} className="border-b border-navy-900/5 last:border-0">
                  <td className="px-4 py-2">
                    <p>{order.contactName ?? "Client anonyme"}</p>
                    <p className="text-xs text-slate-500">{order.contactPhone ?? "—"}</p>
                  </td>
                  <td className="px-4 py-2">
                    {order.totalAmount.toLocaleString("fr-FR")} {order.currency}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[order.status]}`}>
                      {STATUS_LABELS[order.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{new Date(order.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/dashboard/orders/${order.id}`} className="text-xs font-medium text-violet-600 hover:underline">
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
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>
            Page {page} sur {totalPages} — {totalCount} commande{totalCount > 1 ? "s" : ""} au total
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/dashboard/orders?page=${page - 1}${status ? `&status=${status}` : ""}`}
                className="rounded-xl border border-navy-900/10 px-3 py-1.5 font-medium hover:border-navy-900/20"
              >
                Précédent
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/dashboard/orders?page=${page + 1}${status ? `&status=${status}` : ""}`}
                className="rounded-xl border border-navy-900/10 px-3 py-1.5 font-medium hover:border-navy-900/20"
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
