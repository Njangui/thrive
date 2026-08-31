import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { getPlatformOverview } from "@/application/services/admin-overview-service";

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "leaf" | "clay";
}) {
  return (
    <div className="rounded-brand border border-ink/10 bg-white p-4">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-1 font-display text-lg font-semibold ${
          accent === "leaf" ? "text-leaf" : accent === "clay" ? "text-clay" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default async function AdminOverviewPage() {
  await requirePlatformAdmin();
  const overview = await getPlatformOverview();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Vue globale</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Entreprises actives" value={String(overview.organizationsActive)} accent="leaf" />
        <StatCard label="En essai" value={String(overview.organizationsTrialing)} />
        <StatCard label="Abonnées (hors essai)" value={String(overview.organizationsSubscribed)} />
        <StatCard label="Suspendues" value={String(overview.organizationsSuspended)} accent="clay" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-brand border border-ink/10 bg-white p-4">
          <p className="text-xs text-muted">Revenus plateforme (30j, toutes entreprises)</p>
          <p className="mt-1 font-display text-lg font-semibold text-leaf">
            {overview.revenueLast30Days.toLocaleString("fr-FR")} XAF
          </p>
          <p className="mt-1 text-xs text-muted">
            Suppose une devise unique (XAF) — à revoir si plusieurs devises actives.
          </p>
        </div>
        <div className="rounded-brand border border-ink/10 bg-white p-4">
          <p className="text-xs text-muted">Usage IA (30j) — réponses envoyées par l&apos;IA</p>
          <p className="mt-1 font-display text-lg font-semibold">
            {overview.aiMessagesLast30Days.toLocaleString("fr-FR")}
          </p>
        </div>
      </div>
    </div>
  );
}
