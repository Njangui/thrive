import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAffiliate } from "@/application/services/affiliate-auth-service";
import { getAffiliateDashboardStats, listAffiliateLinks } from "@/application/services/affiliate-service";
import { AppError } from "@/lib/errors";

function StatCard({ label, value, detail, tone = "neutral" }: { label: string; value: string | number; detail: string; tone?: "neutral" | "green" | "blue" | "orange" }) {
  const tones = {
    neutral: "bg-slate-50 text-slate-700",
    green: "bg-primary-50 text-primary-700",
    blue: "bg-info-50 text-info-700",
    orange: "bg-warning-50 text-warning-700",
  };
  return (
    <div className="adm-kpi min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="adm-label">{label}</p>
          <p className="mt-1 truncate font-jakarta text-2xl font-extrabold tracking-tight text-navy-900">{value}</p>
          <p className="mt-1 text-[11px] text-slate-400">{detail}</p>
        </div>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold ${tones[tone]}`}>●</span>
      </div>
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

  const [stats, links] = await Promise.all([getAffiliateDashboardStats(affiliate.id), listAffiliateLinks(affiliate.id)]);
  const conversionRate = stats.totalClicks > 0 ? ((stats.totalConversions / stats.totalClicks) * 100).toFixed(1) : "0.0";
  const shareUrl = links[0]?.trackingUrl ?? "Créez votre premier lien d&apos;affiliation";

  return (
    <div className="affiliate-page flex min-h-[calc(100vh-1px)] flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="tokoo -eyebrow">Espace affilié</p>
          <h1 className="mt-1 font-jakarta text-2xl font-extrabold tracking-tight sm:text-3xl">Dashboard affilié</h1>
          <p className="mt-1 text-sm text-slate-500">Bonjour, {affiliate.displayName} ! Voici un aperçu de vos performances.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/affiliate/dashboard/links" className="adm-btn-secondary">Mes liens</Link>
          <Link href="/affiliate/dashboard/payouts" className="adm-btn-primary">Mes paiements</Link>
        </div>
      </div>

      <section className="adm-card flex flex-col gap-3 bg-navy-900 p-4 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">Votre lien d&apos;affiliation</p>
          <p className="mt-1 truncate font-mono text-xs text-white/70">{shareUrl}</p>
        </div>
        <Link href="/affiliate/dashboard/links" className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-navy-900">Gérer mes liens</Link>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Vos affiliés" value={stats.totalReferrals} detail="Organisations référées" tone="green" />
        <StatCard label="Utilisateurs générés" value={stats.totalClicks} detail="Clics sur vos liens" tone="blue" />
        <StatCard label="Conversions" value={stats.totalConversions} detail={`${conversionRate}% des clics`} tone="green" />
        <StatCard label="En attente" value={`${stats.balance.pendingHoldFcfa.toLocaleString("fr-FR")} FCFA`} detail="Commission en rétention" tone="orange" />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.4fr_.8fr]">
        <div className="adm-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="adm-heading-2">Évolution de vos revenus</h2>
              <p className="mt-1 text-xs text-slate-400">Vos commissions sont suivies à chaque conversion.</p>
            </div>
            <Link href="/affiliate/dashboard/payouts" className="text-xs font-semibold text-primary hover:underline">Voir les paiements</Link>
          </div>
          <div className="mt-5 flex min-h-[220px] items-end gap-3 rounded-2xl bg-slate-50 px-4 pb-4 pt-6">
            <div className="flex h-full flex-1 flex-col justify-between text-[10px] text-slate-400">
              <span>Commissions</span><span>Disponible</span><span>En attente</span><span>Payé</span>
            </div>
            <div className="flex h-[170px] flex-1 items-end justify-center gap-2 border-b border-l border-slate-200 pb-0 pl-3">
              {[stats.balance.paidFcfa, stats.balance.availableFcfa, stats.balance.pendingHoldFcfa].map((value, index) => {
                const max = Math.max(1, stats.balance.paidFcfa, stats.balance.availableFcfa, stats.balance.pendingHoldFcfa);
                const height = Math.max(12, Math.round((value / max) * 145));
                return <div key={index} className="w-10 rounded-t-lg bg-primary/80" style={{ height }} title={`${value.toLocaleString("fr-FR")} FCFA`} />;
              })}
            </div>
          </div>
        </div>

        <div className="adm-card">
          <div>
            <h2 className="adm-heading-2">Solde de commissions</h2>
            <p className="mt-1 text-xs text-slate-400">Situation actuelle de votre compte.</p>
          </div>
          <div className="mt-5 rounded-2xl bg-primary-50 p-4">
            <p className="text-xs font-semibold text-primary-700">Disponible</p>
            <p className="mt-1 font-jakarta text-3xl font-extrabold text-navy-900">{stats.balance.availableFcfa.toLocaleString("fr-FR")} <span className="text-sm">FCFA</span></p>
          </div>
          <dl className="mt-4 divide-y divide-slate-100 text-sm">
            <div className="flex justify-between gap-3 py-3"><dt className="text-slate-500">En attente</dt><dd className="font-semibold text-navy-900">{stats.balance.pendingHoldFcfa.toLocaleString("fr-FR")} FCFA</dd></div>
            <div className="flex justify-between gap-3 py-3"><dt className="text-slate-500">Déjà versé</dt><dd className="font-semibold text-navy-900">{stats.balance.paidFcfa.toLocaleString("fr-FR")} FCFA</dd></div>
          </dl>
          <Link href="/affiliate/dashboard/payouts" className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-primary/30 hover:text-primary">Gérer les paiements</Link>
        </div>
      </section>

      <section className="adm-card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="adm-heading-2">Accès rapides</h2>
            <p className="mt-1 text-xs text-slate-400">Tout ce qu&apos;il vous faut pour développer votre activité d&apos;affilié.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Link href="/affiliate/dashboard/links" className="rounded-2xl border border-slate-200 p-4 transition hover:border-primary/30 hover:bg-primary-50/30">
            <p className="font-semibold text-navy-900">Mes liens</p><p className="mt-1 text-xs text-slate-500">Créez et suivez vos liens par canal.</p>
          </Link>
          <Link href="/affiliate/dashboard/payouts" className="rounded-2xl border border-slate-200 p-4 transition hover:border-primary/30 hover:bg-primary-50/30">
            <p className="font-semibold text-navy-900">Paiements</p><p className="mt-1 text-xs text-slate-500">Configurez votre moyen de paiement et demandez un retrait.</p>
          </Link>
          <Link href="/affiliate/dashboard/telegram" className="rounded-2xl border border-slate-200 p-4 transition hover:border-primary/30 hover:bg-primary-50/30">
            <p className="font-semibold text-navy-900">Telegram</p><p className="mt-1 text-xs text-slate-500">Recevez vos notifications et consultez vos statistiques.</p>
          </Link>
        </div>
      </section>
    </div>
  );
}
