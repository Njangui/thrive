import type { Metadata } from "next";
import Link from "next/link";
import { getPlatformSettingNumber } from "@/application/services/platform-settings-service";

export const metadata: Metadata = {
  title: "Programme d'affiliation — SME-OS",
  description: "Recommandez SME-OS et touchez une commission sur chaque nouveau client que vous apportez.",
};

export default async function BecomeAffiliatePage() {
  const commissionRateBps = await getPlatformSettingNumber("affiliate_commission_rate_bps", 2000);
  const commissionPercent = (commissionRateBps / 100).toFixed(0);

  return (
    <div className="mkt-shell">
      <header className="border-b border-ink/10 bg-white">
        <div className="mkt-container flex items-center justify-between py-4">
          <Link href="/" className="font-display text-lg font-bold tracking-tight">
            SME-OS
          </Link>
          <Link href="/login?next=/affiliate/apply" className="mkt-btn-primary !px-5 !py-2.5">
            Devenir affilié
          </Link>
        </div>
      </header>

      <section className="mkt-container py-16 md:py-24 text-center">
        <span className="mkt-badge-pill">Programme d&apos;affiliation</span>
        <h1 className="mkt-section-title mt-4">Recommandez SME-OS, touchez une commission</h1>
        <p className="mx-auto mt-4 max-w-2xl text-ink/70">
          Vous connaissez des commerçants ou prestataires qui gagneraient à organiser leur activité avec SME-OS ?
          Partagez votre lien personnel et touchez {commissionPercent}% sur chaque abonnement souscrit grâce à vous.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/login?next=/affiliate/apply" className="mkt-btn-primary">
            Candidater maintenant
          </Link>
        </div>
      </section>

      <section className="mkt-container max-w-4xl py-16">
        <h2 className="mkt-section-title text-center">Comment ça marche</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          <div className="mkt-card">
            <p className="font-display text-lg font-semibold">1. Candidatez</p>
            <p className="mt-2 text-sm text-ink/70">Un formulaire rapide, puis une validation par notre équipe.</p>
          </div>
          <div className="mkt-card">
            <p className="font-display text-lg font-semibold">2. Partagez votre lien</p>
            <p className="mt-2 text-sm text-ink/70">Chaque candidature approuvée reçoit un lien de suivi unique.</p>
          </div>
          <div className="mkt-card">
            <p className="font-display text-lg font-semibold">3. Touchez votre commission</p>
            <p className="mt-2 text-sm text-ink/70">
              {commissionPercent}% sur chaque nouvel abonnement payé, versé par mobile money ou virement bancaire.
            </p>
          </div>
        </div>
      </section>

      <section className="mkt-container max-w-3xl py-16 text-center">
        <h2 className="mkt-section-title">Prêt à commencer ?</h2>
        <p className="mt-3 text-ink/70">La candidature prend moins de deux minutes.</p>
        <Link href="/login?next=/affiliate/apply" className="mkt-btn-primary mt-6 inline-block">
          Devenir affilié
        </Link>
      </section>
    </div>
  );
}
