import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { getPlatformOverview } from "@/application/services/admin-overview-service";
import { listAllPaymentsForAdmin } from "@/application/services/subscription-payment-service";
import { listOrganizationsForAdmin } from "@/application/services/admin-organizations-service";
import { AdminBadge, AdminCard, AdminSectionHeader, AdminStatCard, AdminTableCard, AdminEmptyState } from "./_components/ui";
import { AdminLineChart, AdminDonutChart } from "./_components/charts";
import { IconAlert, IconBanknote, IconBot, IconClock, IconTag, IconUsers } from "./_components/icons";

function formatFcfa(value: number): string {
  return `${value.toLocaleString("fr-FR")} FCFA`;
}

const PAYMENT_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "En attente", tone: "warning" },
  completed: { label: "Payé", tone: "success" },
  failed: { label: "Échoué", tone: "danger" },
  refunded: { label: "Remboursé", tone: "neutral" },
  cancelled: { label: "Annulé", tone: "neutral" },
};

const ORG_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  active: { label: "Active", tone: "success" },
  suspended: { label: "Suspendue", tone: "danger" },
};

/**
 * Section 79 — repasse design (réplique pixel par pixel d'une référence
 * fournie, sept. 2026). Le cahier Lot C dit "pas de dashboard analytics
 * complexe" : ça reste vrai ici — chaque chiffre/graphique vient
 * directement de `getPlatformOverview()`/`listAllPaymentsForAdmin()`/
 * `listOrganizationsForAdmin()`, rien n'est interpolé ou inventé pour
 * remplir la mise en page. Pas de sélecteur de période (la référence en a
 * un) : aucune plage n'est réellement câblée derrière, donc pas de faux
 * contrôle — la fenêtre réelle (30 jours / 7 jours) est indiquée en clair
 * à la place.
 */
export default async function AdminOverviewPage() {
  await requirePlatformAdmin();
  const [overview, payments, organizations] = await Promise.all([
    getPlatformOverview(),
    listAllPaymentsForAdmin(5),
    listOrganizationsForAdmin(),
  ]);

  const recentOrganizations = organizations.slice(0, 5);
  const totalOrganizations = organizations.length;
  const { organizationsStatusBreakdown: breakdown } = overview;

  const donutSegments = [
    { label: "Actives", value: breakdown.active, color: "#16A34A" },
    { label: "En essai", value: breakdown.trialing, color: "#D97706" },
    { label: "Suspendues", value: breakdown.suspended, color: "#DC2626" },
    { label: "Autres", value: breakdown.other, color: "#94A3B8" },
  ].filter((s) => s.value > 0);

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        title="Vue globale"
        description="Ce qui se passe sur la plateforme SME-OS en ce moment."
        action={<span className="adm-badge-neutral">Fenêtre : 30 derniers jours</span>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <AdminStatCard label="Entreprises actives" value={String(overview.organizationsActive)} icon={<IconUsers className="h-4 w-4" />} />
        <AdminStatCard label="En période d'essai" value={String(overview.organizationsTrialing)} icon={<IconClock className="h-4 w-4" />} />
        <AdminStatCard label="Abonnées (hors starter)" value={String(overview.organizationsSubscribed)} icon={<IconTag className="h-4 w-4" />} />
        <AdminStatCard label="Suspendues" value={String(overview.organizationsSuspended)} icon={<IconAlert className="h-4 w-4" />} />
        <AdminStatCard label="Revenus (30j)" value={formatFcfa(overview.revenueLast30Days)} icon={<IconBanknote className="h-4 w-4" />} />
        <AdminStatCard label="Messages IA (30j)" value={String(overview.aiMessagesLast30Days)} icon={<IconBot className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AdminCard className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="adm-heading-2">Évolution des revenus</h2>
            <span className="adm-label">7 derniers jours</span>
          </div>
          <div className="mt-4">
            <AdminLineChart points={overview.revenueTrend7d.map((p) => ({ label: p.label, value: p.amountFcfa }))} />
          </div>
        </AdminCard>

        <AdminCard>
          <h2 className="adm-heading-2">Répartition des entreprises</h2>
          <div className="mt-4">
            {donutSegments.length > 0 ? (
              <AdminDonutChart segments={donutSegments} centerValue={String(totalOrganizations)} centerLabel="entreprises" />
            ) : (
              <AdminEmptyState>Aucune entreprise pour l&apos;instant.</AdminEmptyState>
            )}
          </div>
        </AdminCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AdminTableCard title="Paiements récents">
          {payments.length === 0 ? (
            <AdminEmptyState>Aucun paiement enregistré pour l&apos;instant.</AdminEmptyState>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>Statut</th>
                  <th>Montant</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <p className="font-medium">{p.organizationName}</p>
                      <p className="text-xs adm-muted">
                        {new Date(p.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                      </p>
                    </td>
                    <td>
                      <AdminBadge tone={PAYMENT_STATUS[p.status]?.tone ?? "neutral"}>{PAYMENT_STATUS[p.status]?.label ?? p.status}</AdminBadge>
                    </td>
                    <td className="text-right font-semibold">{formatFcfa(p.amountFcfa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AdminTableCard>

        <AdminTableCard title="Entreprises récentes">
          {recentOrganizations.length === 0 ? (
            <AdminEmptyState>Aucune entreprise inscrite pour l&apos;instant.</AdminEmptyState>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>Statut</th>
                  <th>Inscrite le</th>
                </tr>
              </thead>
              <tbody>
                {recentOrganizations.map((org) => (
                  <tr key={org.id}>
                    <td>
                      <p className="font-medium">{org.name}</p>
                      <p className="text-xs adm-muted">{org.slug}</p>
                    </td>
                    <td>
                      <AdminBadge tone={ORG_STATUS[org.status]?.tone ?? "neutral"}>{ORG_STATUS[org.status]?.label ?? org.status}</AdminBadge>
                    </td>
                    <td className="text-right adm-muted">
                      {new Date(org.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AdminTableCard>
      </div>
    </div>
  );
}
