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
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#F8FAFC]">
      <div
        className={`h-full rounded-full transition-[width] ${nearLimit ? "bg-warning-600" : "bg-violet-600"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function UsageCard({ gauge }: { gauge: UsageGauge }) {
  return (
    <div className="rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] p-4">
      <p className="text-xs text-slate-500">{gauge.label}</p>
      {gauge.mode === "cumulative" ? (
        <>
          <p className="mt-1 font-jakarta text-lg font-semibold">
            {gauge.result.used.toLocaleString("fr-FR")}
            {gauge.result.limit === -1 ? (
              <span className="ml-1 text-sm font-normal text-slate-500">(illimité)</span>
            ) : (
              <span className="text-sm font-normal text-slate-500"> / {formatLimit(gauge.result.limit)}</span>
            )}
          </p>
          <GaugeBar used={gauge.result.used} limit={gauge.result.limit} />
        </>
      ) : (
        <p className="mt-1 font-jakarta text-lg font-semibold">
          {gauge.result.limit === -1 ? "Illimité" : `Jusqu'à ${formatLimit(gauge.result.limit)}`}
        </p>
      )}
    </div>
  );
}

const PAYMENT_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pending: { label: "En attente", className: "text-danger-600" },
  completed: { label: "Payé", className: "text-violet-600" },
  failed: { label: "Échoué", className: "text-danger-600" },
  refunded: { label: "Remboursé", className: "text-slate-500" },
  cancelled: { label: "Annulé", className: "text-slate-500" },
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
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Mon abonnement</h1>
        <p className="mt-1 text-sm text-slate-500">
          Forfait actuel : <span className="font-medium text-navy-900">{overview.planName}</span>
        </p>
      </div>

      {error && <p className="adm-alert-danger">{error}</p>}
      {success && (
        <p className="adm-alert-success">{success}</p>
      )}

      {overview.trialDaysRemaining !== null && (
        <p className="adm-alert-success">
          Il vous reste {overview.trialDaysRemaining} {overview.trialDaysRemaining === 1 ? "jour" : "jours"} d&apos;essai.
        </p>
      )}

      <div>
        <h2 className="font-jakarta text-lg font-semibold">Mon utilisation</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {overview.usage.map((gauge) => (
            <UsageCard key={gauge.key} gauge={gauge} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-jakarta text-lg font-semibold">Fonctionnalités incluses</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {overview.features.map((f) => (
            <li
              key={f.key}
              className="flex items-center gap-2 rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] px-4 py-3 text-sm"
            >
              <span className={f.included ? "text-violet-600" : "text-slate-500"} aria-hidden>
                {f.included ? "✓" : "—"}
              </span>
              <span className={f.included ? "text-navy-900" : "text-slate-500"}>{f.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="font-jakarta text-lg font-semibold">Les forfaits</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {overview.plans.map((p) => (
            <div
              key={p.key}
              className={`rounded-xl border p-4 ${p.isCurrent ? "border-violet-400 bg-success-50" : "border-navy-900/10 bg-white"}`}
            >
              <p className="font-jakarta text-base font-semibold">{p.name}</p>
              <p className="mt-1 text-lg font-semibold">
                {p.priceFcfa.toLocaleString("fr-FR")} FCFA<span className="text-xs font-normal text-slate-500">/mois</span>
              </p>
              {p.description && <p className="mt-2 text-xs text-slate-500">{p.description}</p>}
              {p.isCurrent ? (
                <p className="mt-3 text-xs font-medium text-violet-600">Votre forfait actuel</p>
              ) : (
                <form action={payPlanAction} className="mt-3">
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="planKey" value={p.key} />
                  <button
                    type="submit"
                    className="w-full rounded-xl bg-navy-900 px-3 py-2 text-xs font-medium text-white transition hover:opacity-90"
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
            <button type="submit" className="rounded-xl border border-navy-900/15 px-3 py-2 text-xs font-medium hover:bg-[#F8FAFC]">
              Renouveler mon forfait actuel
            </button>
          </form>
        )}
      </div>

      <div>
        <h2 className="font-jakarta text-lg font-semibold">Historique des paiements</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)]">
          {payments.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">Aucun paiement pour l&apos;instant.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-navy-900/10 text-left text-xs uppercase text-slate-500">
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
                  const statusInfo = PAYMENT_STATUS_LABEL[payment.status] ?? { label: payment.status, className: "text-slate-500" };
                  return (
                    <tr key={payment.id} className="border-b border-navy-900/5 last:border-0">
                      <td className="px-4 py-2 text-slate-500">{new Date(payment.createdAt).toLocaleDateString("fr-FR")}</td>
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
                            <button type="submit" className="text-xs text-danger-600 hover:underline">
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
