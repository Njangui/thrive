import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAffiliate } from "@/application/services/affiliate-auth-service";
import { getAffiliateDashboardStats } from "@/application/services/affiliate-service";
import { AppError } from "@/lib/errors";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-brand border border-ink/10 bg-white p-5">
      <p className="text-xs font-medium uppercase text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

export default async function AffiliateDashboardPage() {
  let affiliate;
  try {
    affiliate = await requireAffiliate();
  } catch (error) {
    if (error instanceof AppError) redirect("/affiliate/apply");
    throw error;
  }

  const stats = await getAffiliateDashboardStats(affiliate.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Bonjour {affiliate.displayName}</h1>
        <p className="mt-1 text-sm text-muted">Voici un aperçu de votre activité d&apos;affiliation.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Clics" value={stats.totalClicks} />
        <StatCard label="Filleuls" value={stats.totalReferrals} />
        <StatCard label="Conversions" value={stats.totalConversions} />
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold">Solde de commissions</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="En attente de rétention" value={`${stats.balance.pendingHoldFcfa} FCFA`} />
          <StatCard label="Disponible" value={`${stats.balance.availableFcfa} FCFA`} />
          <StatCard label="Déjà versé" value={`${stats.balance.paidFcfa} FCFA`} />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/affiliate/dashboard/links" className="rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white">
          Gérer mes liens
        </Link>
        <Link
          href="/affiliate/dashboard/payouts"
          className="rounded-brand border border-ink/15 px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
        >
          Demander un paiement
        </Link>
        <Link
          href="/affiliate/dashboard/telegram"
          className="rounded-brand border border-ink/15 px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
        >
          Connecter Telegram
        </Link>
      </div>
    </div>
  );
}
