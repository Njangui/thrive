import type { Metadata } from "next";
import Link from "next/link";
import { listPlans, listPlanEntitlements, type PlanSummary } from "@/application/services/plans-repository";
import { PLAN_ORDER, PRICING_FEATURES, applyDbLimits, type LimitsByPlan } from "@/application/config/pricing";
import { buildMarketingMetadata } from "@/app/_lib/marketing-page";

export async function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata({
    path: "/tarifs",
    title: "Tarifs — Flexco",
    description: "Discover gratuit, Starter et Pro : des offres Flexco simples et progressives.",
  });
}

const PLAN_BLURBS: Record<string, string> = {
  free: "Un site professionnel, Telegram, YouTube et les fonctions métier de base.",
  starter: "WhatsApp, automatisation IA, CRM et davantage de canaux.",
  pro: "Plus de comptes, groupes, IA et membres d'équipe.",
};

function planValue(value: string | boolean): { included: boolean; label: string } {
  if (value === true) return { included: true, label: "Inclus" };
  if (value === false) return { included: false, label: "Non inclus" };
  return { included: true, label: value };
}

export default async function PricingPage() {
  const plans = await listPlans();
  const ordered = PLAN_ORDER
    .map((key) => plans.find((plan) => plan.key === key))
    .filter((plan): plan is PlanSummary => Boolean(plan));
  // Quotas lus dans plan_entitlements (source unique) ; repli sur le texte statique si la lecture échoue.
  const limits: LimitsByPlan = {};
  try {
    for (const plan of ordered) {
      const rows = await listPlanEntitlements(plan.key);
      limits[plan.key] = Object.fromEntries(rows.map((row) => [row.entitlementKey, row.limitValue]));
    }
  } catch (error) {
    console.error("/tarifs: lecture des quotas impossible, texte statique utilisé:", error);
  }
  const features = applyDbLimits(PRICING_FEATURES, limits);
  const groups = Array.from(new Set(features.map((feature) => feature.group)));

  return (
    <main className="pricing-page">
      <header className="pricing-nav">
        <Link href="/" className="auth-logo"><span className="auth-logo-mark">C</span><span>Flexco</span></Link>
        <nav><Link href="/">Accueil</Link><Link href="/devenir-affilie">Devenir affilié</Link><Link href="/login">Connexion</Link></nav>
        <Link href="/signup" className="mkt-btn-primary !px-5 !py-2.5">Commencer</Link>
      </header>

      <section className="pricing-hero">
        <span className="mkt-badge-pill">Freemium Flexco</span>
        <h1>Commencez gratuitement. Passez à Starter ou Pro quand votre activité grandit.</h1>
        <p>Trois offres pour commencer : Discover, Starter et Pro. Le quatrième forfait sera ajouté plus tard, lorsque les fonctionnalités correspondantes seront finalisées.</p>
      </section>

      <section className="pricing-grid">
        {ordered.map((plan) => {
          const isStarter = plan.key === "starter";
          return (
            <article key={plan.key} className={`pricing-card ${isStarter ? "popular" : ""}`}>
              {isStarter ? <span className="pricing-popular">Starter</span> : null}
              <p className="pricing-plan-name">{plan.name}</p>
              <p className="pricing-description">{plan.description}</p>
              <div className="pricing-price">
                {plan.priceFcfa.toLocaleString("fr-FR")} <small>FCFA / mois</small>
              </div>
              <Link href="/signup" className={`${isStarter ? "mkt-btn-primary" : "mkt-btn-secondary"} w-full`}>
                {plan.key === "free" ? "Commencer gratuitement" : "Choisir cette offre"}
              </Link>
              <div className="pricing-divider" />

              {groups.map((group) => (
                <div key={group} className="mb-6 last:mb-0">
                  <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400">{group}</p>
                  <ul>
                    {features.filter((feature) => feature.group === group).map((feature) => {
                      const { included, label } = planValue(feature.values[plan.key]);
                      return (
                        <li key={feature.key} className={!included ? "disabled" : ""}>
                          <span>{included ? "✓" : "—"}</span>
                          <div><b>{feature.label}</b><small>{label}</small></div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </article>
          );
        })}
      </section>

      <section className="pricing-bottom">
        <div>
          <span className="mkt-eyebrow">Numéro WhatsApp dédié aux groupes</span>
          <h2>Les groupes WhatsApp restent séparés de votre numéro de messagerie.</h2>
          <p>Votre numéro WhatsApp Business existant peut rester utilisable dans l&apos;application grâce à la coexistence. Les Groupes WhatsApp utilisent un numéro distinct connecté en Cloud API uniquement. Le numéro fourni par Flexco est facturé séparément.</p>
        </div>
        <div className="pricing-economics">
          {ordered.map((plan) => (
            <div key={plan.key}>
              <span>{plan.name}</span>
              <b>{plan.priceFcfa.toLocaleString("fr-FR")} FCFA / mois</b>
              <small>{PLAN_BLURBS[plan.key]}</small>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
