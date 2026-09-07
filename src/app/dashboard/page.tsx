import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getDashboardSummary } from "@/application/services/dashboard-service";
import { getAnalyticsSummary } from "@/application/services/analytics-service";

function formatAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString("fr-FR")} ${currency}`;
}

export default async function DashboardHomePage() {
  const { organizationId } = await requireCurrentOrganization();
  const [summary, activity] = await Promise.all([
    getDashboardSummary(organizationId),
    getAnalyticsSummary(organizationId, 30),
  ]);

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

  // Lot H, Partie 2 (master prompt §55) — "pas un nouvel écran dédié,
  // intégrez dans l'existant pour rester simple". Volontairement une
  // sélection des compteurs, pas les 8 : `lead_created`/`order_created`
  // font doublon avec "Nouveaux leads (7j)"/"Commandes en attente"
  // ci-dessus (déjà lus directement depuis leurs tables respectives, pas
  // depuis analytics_events) ; `product_click`/`conversation_started` ne
  // sont pas encore émis par ce lot (voir analytics-service.ts). Cette
  // section n'affiche donc QUE la visibilité réellement nouvelle apportée
  // par ce lot : trafic public + engagement CTA + diffusion sociale.
  const activityCards = [
    { label: "Vues de votre page (30j)", value: String(activity.counts.page_view) },
    { label: "Vues de produits (30j)", value: String(activity.counts.product_view) },
    { label: "Clics WhatsApp/contact (30j)", value: String(activity.counts.cta_click) },
    { label: "Publications diffusées (30j)", value: String(activity.counts.publication_published) },
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

      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight">Activité (30 derniers jours)</h2>
        <p className="text-xs text-muted">Visites de votre page publique et intérêt de vos clients.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {activityCards.map((card) => (
            <div key={card.label} className="rounded-brand border border-ink/10 bg-white p-4">
              <p className="text-xs text-muted">{card.label}</p>
              <p className="mt-1 font-display text-xl font-semibold text-ink">{card.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
