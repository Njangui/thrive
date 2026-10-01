import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { runDiagnostic } from "@/application/services/admin-diagnostic-service";
import { AdminBadge, AdminCard } from "../_components/ui";

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Douala" }) : "—");

/**
 * Diagnostic d'accès : « pourquoi ce compte voit-il une fonctionnalité
 * verrouillée ? ». Saisir le nom (ou l'identifiant) de l'entreprise.
 */
export default async function AdminDiagnosticPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  await requirePlatformAdmin();
  const result = await runDiagnostic(q);
  const d = result.detail;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Diagnostic d&apos;accès</h1>
        <p className="mt-1 text-sm text-slate-500">
          Affiche ce que l&apos;application lit réellement pour une entreprise : abonnement, plan réel et effectif, limites en base, décisions et derniers paiements.
        </p>
      </div>

      <form method="get" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Nom de l'entreprise ou identifiant"
          className="min-w-64 flex-1 rounded-xl border border-navy-900/[0.09] px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white">Analyser</button>
      </form>

      {result.missingEntitlements.length > 0 && (
        <p className="rounded-xl border border-warning-600/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          Grille de limites incomplète en base : {result.missingEntitlements.length} ligne(s) manquante(s) (une ligne absente = fonctionnalité verrouillée pour ce plan), par exemple{" "}
          {result.missingEntitlements.slice(0, 4).map((m) => `${m.planKey} / ${m.entitlementKey}`).join(", ")}. Appliquez la migration 0074_repair_plan_entitlements_grid.sql.
        </p>
      )}

      {q && !d && result.matches.length === 0 && <p className="text-sm text-slate-500">Aucune entreprise trouvée pour « {q} ».</p>}

      {!d && result.matches.length > 1 && (
        <AdminCard>
          <p className="text-sm text-slate-600">Plusieurs entreprises correspondent, précisez ou choisissez :</p>
          <ul className="mt-2 space-y-1 text-sm">
            {result.matches.map((m) => (
              <li key={m.id}><a className="text-violet-700 underline" href={`/admin/diagnostic?q=${m.id}`}>{m.name}</a> <span className="text-slate-400">{m.id}</span></li>
            ))}
          </ul>
        </AdminCard>
      )}

      {d && (
        <>
          <AdminCard>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-jakarta text-lg font-semibold">{d.organizationName}</h2>
              <AdminBadge tone="neutral">réel : {d.realPlan}</AdminBadge>
              <AdminBadge tone={d.effectivePlan === d.realPlan ? "neutral" : "violet"}>effectif : {d.effectivePlan}</AdminBadge>
              <AdminBadge tone={d.promoPhase === "active" ? "success" : "neutral"}>essai : {d.promoPhase}</AdminBadge>
            </div>
            <p className="mt-3 text-sm text-slate-700">{d.explanation}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Ligne d&apos;abonnement</dt><dd className="font-medium">{d.subscription ? `${d.subscription.plan_key} · ${d.subscription.status}` : "aucune"}</dd></div>
              <div><dt className="text-slate-500">Fin de période</dt><dd className="font-medium">{fmt(d.subscription?.current_period_end ?? null)}</dd></div>
            </dl>
          </AdminCard>

          <AdminCard>
            <h2 className="font-jakarta text-lg font-semibold">Décisions de l&apos;application</h2>
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="py-1">Fonctionnalité</th><th>Autorisée</th><th>Limite</th></tr></thead>
              <tbody>
                {d.features.map((f) => (
                  <tr key={f.key} className="border-t border-navy-900/[0.06]">
                    <td className="py-1.5 font-mono text-xs">{f.key}</td>
                    <td>{f.enabled ? "oui" : "non"}</td>
                    <td>{f.limit === -1 ? "illimité" : f.limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-500">
              Limites lues en base (plan_entitlements) : {d.limitsInDb.length === 0 ? "aucune ligne trouvée" : d.limitsInDb.map((l) => `${l.plan_key}/${l.entitlement_key}=${l.limit_value}`).join(" · ")}
            </p>
          </AdminCard>

          <AdminCard>
            <h2 className="font-jakarta text-lg font-semibold">Derniers paiements d&apos;abonnement</h2>
            {d.payments.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Aucun paiement enregistré.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead><tr className="text-left text-slate-500"><th className="py-1">Date</th><th>Type</th><th>Plan</th><th>Montant</th><th>Statut</th></tr></thead>
                <tbody>
                  {d.payments.map((p, i) => (
                    <tr key={i} className="border-t border-navy-900/[0.06]">
                      <td className="py-1.5">{fmt(p.created_at)}</td><td>{p.payment_type}</td><td>{p.plan_key ?? "—"}</td><td>{p.amount_fcfa.toLocaleString("fr-FR")}</td><td>{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-slate-500">Un paiement « completed » alors que le plan réel reste « free » = le paiement n&apos;a pas été appliqué à l&apos;abonnement.</p>
          </AdminCard>
        </>
      )}
    </div>
  );
}
