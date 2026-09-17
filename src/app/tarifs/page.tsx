import type { Metadata } from "next";
import Link from "next/link";
import { listPlans, listPlanEntitlements, type PlanKey } from "@/application/services/plans-repository";
import { PLAN_ORDER, PRICING_FEATURES } from "@/application/config/pricing";

export const metadata: Metadata = {
  title: "Tarifs — CRESYVA",
  description: "Des offres simples pour piloter votre entreprise avec CRESYVA.",
};

function entitlementLabel(key: string, value: number): string | null {
  if (key.endsWith("_dedicated_bonus")) return null;
  if (key === "whatsapp_groups") return value === -1 ? "Illimité" : `${value} groupes`;
  if (key === "broadcast_contacts") return value === -1 ? "Illimité" : `${value} contacts`;
  if (key === "ai_credits") return value === -1 ? "Illimité" : `${value} crédits`;
  if (key === "social_accounts") return value === -1 ? "Illimité" : `${value} comptes`;
  return value > 0 ? "Inclus" : null;
}

export default async function PricingPage() {
  const plans = await listPlans();
  const matrix = await Promise.all(plans.map(async p => ({ ...p, entitlements: await listPlanEntitlements(p.key) })));
  const byPlan = new Map(matrix.map(p => [p.key, new Map(p.entitlements.map(e => [e.entitlementKey, e.limitValue]))]));
  const ordered = PLAN_ORDER.map(key => matrix.find(p => p.key === key)).filter(Boolean) as typeof matrix;

  return <main className="pricing-page"><header className="pricing-nav"><Link href="/" className="auth-logo"><span className="auth-logo-mark">S</span><span>CRESYVA</span></Link><nav><Link href="/">Accueil</Link><Link href="/devenir-affilie">Devenir affilié</Link><Link href="/login">Connexion</Link></nav><Link href="/signup" className="mkt-btn-primary !px-5 !py-2.5">Commencer</Link></header>
    <section className="pricing-hero"><span className="mkt-badge-pill">Tarification transparente</span><h1>Un plan qui grandit avec votre entreprise.</h1><p>Commencez simplement. Montez en puissance quand vos ventes, vos canaux et votre équipe grandissent. Les modules métier affichés dans votre espace s’adaptent aussi à votre secteur.</p></section>
    <section className="pricing-grid">{ordered.map((plan) => { const isPopular = plan.key === "business"; const ent = byPlan.get(plan.key)!; return <article key={plan.key} className={`pricing-card ${isPopular ? "popular" : ""}`}>{isPopular && <span className="pricing-popular">Le plus choisi</span>}<p className="pricing-plan-name">{plan.name}</p><p className="pricing-description">{plan.description}</p><div className="pricing-price">{plan.priceFcfa.toLocaleString("fr-FR")} <small>FCFA / mois</small></div><Link href="/signup" className={isPopular ? "mkt-btn-primary w-full" : "mkt-btn-secondary w-full"}>{plan.key === "starter" ? "Essayer gratuitement" : "Choisir cette offre"}</Link><div className="pricing-divider"/><ul>{PRICING_FEATURES.map(feature => { const value = feature.kind === "entitlement" ? ent.get(feature.key) : undefined; const included = feature.kind === "core" ? true : (value ?? 0) !== 0; const detail = value === undefined ? null : entitlementLabel(feature.key, value); return <li key={feature.key} className={!included ? "disabled" : ""}><span>{included ? "✓" : "—"}</span><div><b>{feature.label}</b>{detail && <small>{detail}</small>}</div></li>; })}</ul></article>; })}</section>
    <section className="pricing-bottom"><div><span className="mkt-eyebrow">Besoin d’aide ?</span><h2>Choisissez selon votre volume, pas selon la complexité.</h2><p>Les fonctionnalités métier restent adaptées à votre secteur. Les quotas ci-dessus pilotent surtout les ressources qui génèrent des coûts variables.</p></div><div className="pricing-economics"><div><span>Starter</span><b>Coûts variables maîtrisés</b><small>IA et canaux plafonnés</small></div><div><span>Business</span><b>Équilibre croissance / marge</b><small>Plus de canaux et d’automatisation</small></div><div><span>Pro</span><b>Volume élevé</b><small>Quotas supérieurs pour équipes actives</small></div></div></section>
  </main>;
}
