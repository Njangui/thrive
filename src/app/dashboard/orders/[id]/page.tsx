import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { getOrderDetail, markOrderCompleted, cancelOrder, type OrderStatus } from "@/application/services/order-service";
import { NotFoundError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  completed: "Terminée",
  cancelled: "Annulée",
};

async function completeOrderAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin", "manager", "cashier"]);
  await markOrderCompleted(organizationId, orderId, membership.userId);
  redirect(`/dashboard/orders/${orderId}?success=${encodeURIComponent("Commande finalisée.")}`);
}

async function cancelOrderAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager", "cashier"]);
  await cancelOrder(organizationId, orderId);
  redirect(`/dashboard/orders/${orderId}?success=${encodeURIComponent("Commande annulée.")}`);
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  const { id } = await params;
  const { success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  let order;
  try {
    order = await getOrderDetail(organizationId, id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="flex flex-col gap-4">
          <Link href="/dashboard/orders" className="text-sm text-leaf hover:underline">
            ← Retour aux commandes
          </Link>
          <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">
            Commande introuvable.
          </p>
        </div>
      );
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/orders" className="text-sm text-leaf hover:underline">
          ← Retour aux commandes
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Commande du {new Date(order.createdAt).toLocaleDateString("fr-FR")}
          </h1>
          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs">{STATUS_LABELS[order.status]}</span>
        </div>
      </div>

      {success && <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>}

      <section className="rounded-brand border border-ink/10 bg-white p-4">
        <h2 className="font-display text-lg font-semibold">Client</h2>
        <p className="mt-2 text-sm">{order.contactName ?? "Client anonyme"}</p>
        <p className="text-sm text-muted">{order.contactPhone ?? "—"}</p>
        {order.notes && <p className="mt-3 text-sm text-muted">Notes : {order.notes}</p>}
      </section>

      <section className="rounded-brand border border-ink/10 bg-white p-4">
        <h2 className="font-display text-lg font-semibold">Articles</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between border-b border-ink/5 pb-2 last:border-0">
              <span>
                {item.label} × {item.quantity}
              </span>
              <span className="text-muted">{(item.unitPrice * item.quantity).toLocaleString("fr-FR")}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-right font-semibold">
          Total : {order.totalAmount.toLocaleString("fr-FR")} {order.currency}
        </p>
      </section>

      {order.status !== "completed" && order.status !== "cancelled" && (
        <div className="flex gap-3">
          <form action={completeOrderAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="orderId" value={order.id} />
            <SubmitButton pendingLabel="..." className="rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              Marquer comme terminée
            </SubmitButton>
          </form>
          <form action={cancelOrderAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="orderId" value={order.id} />
            <SubmitButton pendingLabel="..." className="rounded-brand border border-clay/30 px-4 py-2 text-sm font-medium text-clay disabled:opacity-60">
              Annuler
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
