import Link from "next/link";
import { listPlans, listPlanEntitlements, type PlanKey } from "@/application/services/plans-repository";
import { MarketingNav } from "../_components/marketing-nav";
import { MarketingFooter } from "../_components/marketing-footer";
import { MIcon } from "../_components/marketing-icons";

export const metadata = {
  title: "Tarifs — Thrive",
  description: "Des tarifs simples et transparents pour gérer votre commerce avec Thrive.",
};

const ENTITLEMENT_LABELS: Record<string, (limit: number) => string> = {
  whatsapp_groups: (n) => (n === -1 ? "Groupes WhatsApp illimités" : `${n} groupe${n > 1 ? "s" : ""} WhatsApp`),
  broadcast_contacts: (n) => (n === -1 ? "Diffusions illimitées" : `${n} contacts par diffusion`),
  ai_credits: (n) => (n === -1 ? "Crédits IA illimités" : `${n.toLocaleString("fr-FR")} crédits IA / mois`),
  social_accounts: (n) => (n === -1 ? "Comptes sociaux illimités" : `${n} compte${n > 1 ? "s" : ""} social${n > 1 ? "aux" : ""}`),
  facebook_messenger: (n) => (n > 0 ? "Messenger Facebook" : ""),
  instagram_messages: (n) => (n > 0 ? "Messages Instagram" : ""),
  linkedin: (n) => (n > 0 ? "Publication LinkedIn" : ""),
  tiktok: (n) => (n > 0 ? "Publication TikTok" : ""),
};

const ENTITLEMENT_ORDER = [
  "whatsapp_groups",
  "broadcast_contacts",
  "ai_credits",
  "social_accounts",
  "facebook_messenger",
  "instagram_messages",
  "linkedin",
  "tiktok",
];

export default async function TarifsPage() {
  const plans = await listPlans();
  const entitlementsByPlan = new Map<PlanKey, Awaited<ReturnType<typeof listPlanEntitlements>>>();
  for (const plan of plans) {
    entitlementsByPlan.set(plan.key, await listPlanEntitlements(plan.key));
  }

  return (
    <div className="bg-white">
      <MarketingNav />

      <section className="px-5 py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Des tarifs simples et transparents
          </h1>
          <p className="mt-2 text-sm text-muted">Choisissez le plan qui convient le mieux à votre commerce.</p>

          <div className="mt-12 grid grid-cols-1 gap-5 text-left sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const entitlements = entitlementsByPlan.get(plan.key) ?? [];
              const featured = plan.key === "business";
              return (
                <div
                  key={plan.key}
                  className={`relative flex flex-col rounded-2xl border p-6 shadow-sm ${
                    featured ? "border-primary bg-primary text-white" : "border-ink/5 bg-white"
                  }`}
                >
                  {featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-pink px-3 py-1 text-xs font-semibold text-white">
                      Populaire
                    </span>
                  )}
                  <p className={`font-display text-lg font-bold ${featured ? "text-white" : "text-ink"}`}>
                    {plan.name}
                  </p>
                  <p className={`mt-1 text-sm ${featured ? "text-white/80" : "text-muted"}`}>{plan.description}</p>
                  <p className="mt-5">
                    <span className={`font-display text-3xl font-bold ${featured ? "text-white" : "text-ink"}`}>
                      {plan.priceFcfa === 0 ? "Gratuit" : `${plan.priceFcfa.toLocaleString("fr-FR")} FCFA`}
                    </span>
                    {plan.priceFcfa > 0 && (
                      <span className={`text-sm ${featured ? "text-white/70" : "text-muted"}`}>/mois</span>
                    )}
                  </p>

                  <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                    {ENTITLEMENT_ORDER.map((key) => {
                      const row = entitlements.find((e) => e.entitlementKey === key);
                      if (!row) return null;
                      const label = ENTITLEMENT_LABELS[key]?.(row.limitValue) ?? key;
                      if (!label) return null;
                      return (
                        <li key={key} className="flex items-center gap-2">
                          <MIcon name="check" className={`h-4 w-4 shrink-0 ${featured ? "text-white" : "text-success"}`} />
                          <span className={featured ? "text-white/90" : "text-ink/80"}>{label}</span>
                        </li>
                      );
                    })}
                  </ul>

                  <Link
                    href="/onboarding"
                    className={`mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-medium ${
                      featured ? "bg-white text-primary-dark hover:bg-white/90" : "bg-primary text-white hover:bg-primary-dark"
                    }`}
                  >
                    Commencer
                  </Link>
                </div>
              );
            })}
          </div>

          <p className="mt-10 text-sm text-muted">
            Besoin de quelque chose sur mesure ?{" "}
            <a href="/contact" className="font-medium text-primary hover:underline">
              Contactez-nous
            </a>
            .
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
