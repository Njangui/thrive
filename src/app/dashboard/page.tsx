import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getDashboardSummary } from "@/application/services/dashboard-service";

function formatAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString("fr-FR")} ${currency}`;
}

export default async function DashboardHomePage() {
  const { organizationId } = await requireCurrentOrganization();
  const summary = await getDashboardSummary(organizationId);

  const cards = [
    { label: "Revenus (30j)", value: formatAmount(summary.revenueLast30Days, summary.currency) },
    { label: "Dépenses (30j)", value: formatAmount(summary.expensesLast30Days, summary.currency) },
    { label: "Résultat (30j)", value: formatAmount(summary.resultLast30Days, summary.currency) },
    { label: "Commandes en attente", value: String(summary.ordersPending) },
    { label: "Nouveaux leads (7j)", value: String(summary.newLeadsLast7Days) },
    { label: "Clients", value: String(summary.customersCount) },
    { label: "Conversations à traiter", value: String(summary.conversationsNeedingAttention), alert: summary.conversationsNeedingAttention > 0 },
    { label: "Produits en rupture", value: String(summary.productsOutOfStock), alert: summary.productsOutOfStock > 0 },
    { label: "Publications programmées", value: String(summary.postsScheduled) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Comment va mon entreprise ?</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className={`rounded-brand border p-4 ${
              card.alert ? "border-clay/30 bg-clay/5" : "border-ink/10 bg-white"
            }`}
          >
            <p className="text-xs text-muted">{card.label}</p>
            <p className={`mt-1 font-display text-xl font-semibold ${card.alert ? "text-clay" : "text-ink"}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
