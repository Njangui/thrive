import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getSubscriptionOverview, type UsageGauge } from "@/application/services/subscription-service";

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

export default async function SubscriptionPage() {
  const { organizationId } = await requireCurrentOrganization();
  const overview = await getSubscriptionOverview(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Mon abonnement</h1>
        <p className="mt-1 text-sm text-muted">
          Forfait actuel : <span className="font-medium text-ink">{overview.planName}</span>
        </p>
      </div>

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
              {p.isCurrent && <p className="mt-3 text-xs font-medium text-leaf">Votre forfait actuel</p>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          Le changement de forfait en ligne arrive bientôt — contactez-nous pour passer à un forfait supérieur dès
          maintenant.
        </p>
      </div>
    </div>
  );
}
