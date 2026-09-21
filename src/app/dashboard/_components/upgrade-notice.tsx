import Link from "next/link";
import { GATED_FEATURES, PLAN_LABELS, type GatedFeatureKey } from "@/application/config/feature-gates";

/**
 * Écran affiché à la place d'une page verrouillée par l'offre (freemium v2).
 * Toujours un appel à l'action clair vers /dashboard/subscription — jamais
 * une page blanche ni une erreur : le commerçant voit CE qu'il obtient en
 * passant à l'offre supérieure.
 */
export function UpgradeNotice({ feature, extra }: { feature: GatedFeatureKey; extra?: string }) {
  const gate = GATED_FEATURES[feature];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">{gate.label}</h1>
        <p className="mt-1 text-sm text-slate-500">{gate.description}</p>
      </div>
      <section className="adm-card flex flex-col gap-3 bg-gradient-to-r from-violet-50 via-white to-white p-6">
        <p className="adm-eyebrow">Offre {PLAN_LABELS[gate.minPlan]} et supérieures</p>
        <h2 className="adm-heading-2 text-lg">Cette fonctionnalité n&apos;est pas incluse dans votre offre actuelle</h2>
        <p className="text-sm text-slate-600">
          Passez à l&apos;offre {PLAN_LABELS[gate.minPlan]} pour l&apos;activer. Vos données existantes sont conservées.
          {extra ? ` ${extra}` : ""}
        </p>
        <div>
          <Link href="/dashboard/subscription" className="adm-btn-primary inline-flex">
            Voir les offres
          </Link>
        </div>
      </section>
    </div>
  );
}
