import { redirect } from "next/navigation";
import { requireAffiliate } from "@/application/services/affiliate-auth-service";
import {
  getAffiliateBalance,
  updateAffiliatePayoutMethod,
} from "@/application/services/affiliate-service";
import { requestPayout, listAffiliatePayouts } from "@/application/services/affiliate-payout-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { PayoutMethod } from "@/domain/entities/affiliate";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

const PAYOUT_STATUS_LABELS: Record<string, string> = {
  requested: "En attente",
  approved: "Approuvé",
  rejected: "Rejeté",
  paid: "Payé",
};

async function updatePayoutMethodAction(formData: FormData) {
  "use server";
  const affiliate = await requireAffiliate();
  const type = String(formData.get("type") ?? "mobile_money") as PayoutMethod["type"];
  try {
    await updateAffiliatePayoutMethod(affiliate.id, {
      type,
      operator: type === "mobile_money" ? String(formData.get("operator") ?? "") || undefined : undefined,
      accountName: String(formData.get("accountName") ?? "") || undefined,
      accountNumber: String(formData.get("accountNumber") ?? ""),
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'enregistrement.";
    redirect(`/affiliate/dashboard/payouts?error=${encodeURIComponent(message)}`);
  }
  redirect("/affiliate/dashboard/payouts?success=method");
}

async function requestPayoutAction() {
  "use server";
  const affiliate = await requireAffiliate();
  try {
    await requestPayout(affiliate.id);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la demande de paiement.";
    redirect(`/affiliate/dashboard/payouts?error=${encodeURIComponent(message)}`);
  }
  redirect("/affiliate/dashboard/payouts?success=request");
}

export default async function AffiliatePayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;

  let affiliate;
  try {
    affiliate = await requireAffiliate();
  } catch (err) {
    if (err instanceof AppError) redirect("/affiliate/apply");
    throw err;
  }

  const [balance, payouts] = await Promise.all([getAffiliateBalance(affiliate.id), listAffiliatePayouts(affiliate.id)]);

  const supabase = getSupabaseServiceClient();
  const { data: affiliateRow } = await supabase.from("affiliates").select("payout_method").eq("id", affiliate.id).single();
  const currentMethod = (affiliateRow?.payout_method ?? null) as PayoutMethod | null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Paiements</h1>
        <p className="mt-1 text-sm text-muted">Solde disponible : {balance.availableFcfa} FCFA</p>
      </div>

      {success === "method" && <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">Méthode de paiement enregistrée.</p>}
      {success === "request" && <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">Demande de paiement envoyée.</p>}
      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}

      <div className="rounded-brand border border-ink/10 bg-white p-6">
        <h2 className="font-display text-lg font-semibold">Méthode de paiement</h2>
        <form action={updatePayoutMethodAction} className="mt-4 flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="type">
              Type
            </label>
            <select id="type" name="type" defaultValue={currentMethod?.type ?? "mobile_money"} className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm">
              <option value="mobile_money">Mobile money</option>
              <option value="bank_transfer">Virement bancaire</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="operator">
              Opérateur (mobile money uniquement)
            </label>
            <input id="operator" name="operator" defaultValue={currentMethod?.operator ?? ""} placeholder="MTN / Orange" className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="accountName">
              Nom du titulaire
            </label>
            <input id="accountName" name="accountName" defaultValue={currentMethod?.accountName ?? ""} className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="accountNumber">
              Numéro (mobile money ou IBAN/RIB)
            </label>
            <input id="accountNumber" name="accountNumber" required defaultValue={currentMethod?.accountNumber ?? ""} className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm" />
          </div>
          <SubmitButton pendingLabel="Enregistrement..." className="w-fit rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white">
            Enregistrer
          </SubmitButton>
        </form>
      </div>

      <form action={requestPayoutAction}>
        <SubmitButton pendingLabel="Envoi..." className="rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          Demander un paiement
        </SubmitButton>
      </form>

      <div className="overflow-x-auto rounded-brand border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Montant</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Référence</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3">{new Date(p.requestedAt).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3">
                  {p.amountFcfa} {p.currencyCode}
                </td>
                <td className="px-4 py-3">{PAYOUT_STATUS_LABELS[p.status] ?? p.status}</td>
                <td className="px-4 py-3">{p.paymentReference ?? "—"}</td>
              </tr>
            ))}
            {payouts.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  Aucune demande de paiement pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
