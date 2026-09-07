import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership, getCurrentUserEmail } from "@/application/services/auth-service";
import { getSubscriptionOverview, type UsageGauge } from "@/application/services/subscription-service";
import {
  initiatePayment,
  cancelPendingPayment,
  listPaymentsForOrganization,
} from "@/application/services/subscription-payment-service";
import type { PlanKey } from "@/application/services/plans-repository";
import { AppError } from "@/lib/errors";

function formatLimit(value: number): string {
  return value === -1 ? "Illimité" : value.toLocaleString("fr-FR");
}

function GaugeBar({ used, limit }: { used: number; limit: number }) {
  if (limit === -1) return null;
  const pct = limit <= 0 ? 100 : Math.min((used / limit) * 100, 100);
  const nearLimit = pct >= 90;
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-paper">
      <div
        className={`h-full rounded-full transition-[width] ${nearLimit ? "bg-clay" : "bg-leaf"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function UsageCard({ gauge }: { gauge: UsageGauge }) {
  return (
    <div className="rounded-brand border border-ink/10 bg-white p-4">
      <p className="text-xs text-muted">{gauge.label}</p>
      {gauge.mode === "cumulative" ? (
        <>
          <p className="mt-1 font-display text-lg font-semibold">
            {gauge.result.used.toLocaleString("fr-FR")}
            {gauge.result.limit === -1 ? (
              <span className="ml-1 text-sm font-normal text-muted">(illimité)</span>
            ) : (
              <span className="text-sm font-normal text-muted"> / {formatLimit(gauge.result.limit)}</span>
            )}
          </p>
          <GaugeBar used={gauge.result.used} limit={gauge.result.limit} />
        </>
      ) : (
        <p className="mt-1 font-display text-lg font-semibold">
          {gauge.result.limit === -1 ? "Illimité" : `Jusqu'à ${formatLimit(gauge.result.limit)}`}
        </p>
      )}
    </div>
  );
}

const PAYMENT_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pending: { label: "En attente", className: "text-clay" },
  completed: { label: "Payé", className: "text-leaf" },
  failed: { label: "Échoué", className: "text-clay" },
  refunded: { label: "Remboursé", className: "text-muted" },
  cancelled: { label: "Annulé", className: "text-muted" },
};

async function payPlanAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const planKey = String(formData.get("planKey") ?? "") as PlanKey;
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const email = await getCurrentUserEmail();

  if (!email) {
    redirect(`/dashboard/subscription?error=${encodeURIComponent("Email de session introuvable — reconnectez-vous.")}`);
  }

  let paymentUrl: string;
  try {
    const result = await initiatePayment(organizationId, planKey, membership.userId, email as string);
    if (!result.paymentUrl) throw new Error("URL de paiement manquante dans la réponse NotchPay.");
    paymentUrl = result.paymentUrl;
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'initiation du paiement.";
    redirect(`/dashboard/subscription?error=${encodeURIComponent(message)}`);
  }

  redirect(paymentUrl);
}

async function cancelPaymentAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  await requireMembership(organizationId, ["owner", "admin"]);

  try {
    await cancelPendingPayment(organizationId, paymentId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'annulation du paiement.";
    redirect(`/dashboard/subscription?error=${encodeURIComponent(message)}`);
  }
  redirect("/dashboard/subscription?success=" + encodeURIComponent("Paiement annulé."));
}

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const [overview, payments] = await Promise.all([
    getSubscriptionOverview(organizationId),
    listPaymentsForOrganization(organizationId, 10),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Mon abonnement</h1>
        <p className="mt-1 text-sm text-muted">
          Forfait actuel : <span className="font-medium text-ink">{overview.planName}</span>
        </p>
      </div>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      {overview.trialDaysRemaining !== null && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">
          Il vous reste {overview.trialDaysRemaining} {overview.trialDaysRemaining === 1 ? "jour" : "jours"} d&apos;essai.
        </p>
      )}

      <div>
        <h2 className="font-display text-lg font-semibold">Mon utilisation</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {overview.usage.map((gauge) => (
            <UsageCard key={gauge.key} gauge={gauge} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold">Fonctionnalités incluses</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {overview.features.map((f) => (
            <li
              key={f.key}
              className="flex items-center gap-2 rounded-brand border border-ink/10 bg-white px-4 py-3 text-sm"
            >
              <span className={f.included ? "text-leaf" : "text-muted"} aria-hidden>
                {f.included ? "✓" : "—"}
              </span>
              <span className={f.included ? "text-ink" : "text-muted"}>{f.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold">Les forfaits</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {overview.plans.map((p) => (
            <div
              key={p.key}
              className={`rounded-brand border p-4 ${p.isCurrent ? "border-leaf bg-leaf/5" : "border-ink/10 bg-white"}`}
            >
              <p className="font-display text-base font-semibold">{p.name}</p>
              <p className="mt-1 text-lg font-semibold">
                {p.priceFcfa.toLocaleString("fr-FR")} FCFA<span className="text-xs font-normal text-muted">/mois</span>
              </p>
              {p.description && <p className="mt-2 text-xs text-muted">{p.description}</p>}
              {p.isCurrent ? (
                <p className="mt-3 text-xs font-medium text-leaf">Votre forfait actuel</p>
              ) : (
                <form action={payPlanAction} className="mt-3">
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="planKey" value={p.key} />
                  <button
                    type="submit"
                    className="w-full rounded-brand bg-ink px-3 py-2 text-xs font-medium text-white transition hover:opacity-90"
                  >
                    Passer à ce forfait
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
        {overview.status !== "trialing" && (
          <form action={payPlanAction} className="mt-3">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="planKey" value={overview.planKey} />
            <button type="submit" className="rounded-brand border border-ink/20 px-3 py-2 text-xs font-medium hover:bg-paper">
              Renouveler mon forfait actuel
            </button>
          </form>
        )}
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold">Historique des paiements</h2>
        <div className="mt-3 overflow-x-auto rounded-brand border border-ink/10 bg-white">
          {payments.length === 0 ? (
            <p className="p-6 text-sm text-muted">Aucun paiement pour l&apos;instant.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Objet</th>
                  <th className="px-4 py-2">Montant</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const statusInfo = PAYMENT_STATUS_LABEL[payment.status] ?? { label: payment.status, className: "text-muted" };
                  return (
                    <tr key={payment.id} className="border-b border-ink/5 last:border-0">
                      <td className="px-4 py-2 text-muted">{new Date(payment.createdAt).toLocaleDateString("fr-FR")}</td>
                      <td className="px-4 py-2">
                        {payment.paymentType === "plan_subscription"
                          ? `Abonnement — forfait ${payment.planKey}`
                          : `Add-on — ${payment.addonKey} × ${payment.addonQuantity}`}
                      </td>
                      <td className="px-4 py-2 font-medium">{payment.amountFcfa.toLocaleString("fr-FR")} FCFA</td>
                      <td className={`px-4 py-2 font-medium ${statusInfo.className}`}>{statusInfo.label}</td>
                      <td className="px-4 py-2 text-right">
                        {payment.status === "pending" && (
                          <form action={cancelPaymentAction}>
                            <input type="hidden" name="organizationId" value={organizationId} />
                            <input type="hidden" name="paymentId" value={payment.id} />
                            <button type="submit" className="text-xs text-clay hover:underline">
                              Annuler
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
