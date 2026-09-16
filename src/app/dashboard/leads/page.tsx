import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { listLeadsForOrg, updateLeadStatus, LEAD_STATUSES, type LeadStatus } from "@/application/services/lead-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

const PAGE_SIZE = 50;

const STATUS_LABELS: Record<LeadStatus, string> = {
  visitor: "Visiteur",
  lead: "Prospect",
  qualified: "Qualifié",
  opportunity: "Opportunité",
  customer: "Client",
  lost: "Perdu",
};

const STATUS_STYLES: Record<LeadStatus, string> = {
  visitor: "bg-slate-100 text-slate-600",
  lead: "bg-slate-100 text-navy-900",
  qualified: "bg-amber-500/10 text-amber-600",
  opportunity: "bg-amber-500/10 text-amber-600",
  customer: "bg-success-50 text-success-700",
  lost: "bg-danger-50 text-danger-700",
};

function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

async function updateLeadStatusAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin", "manager", "sales"]);

  const leadId = String(formData.get("leadId") ?? "");
  const status = String(formData.get("status") ?? "");
  const currentQuery = String(formData.get("currentQuery") ?? "");

  try {
    if (!isLeadStatus(status)) throw new AppError("Statut invalide.", 400, "validation");
    await updateLeadStatus(organizationId, leadId, status, membership.userId);
    redirect(`/dashboard/leads?${currentQuery}&success=${encodeURIComponent("Statut mis à jour.")}`);
  } catch (error) {
    if (error instanceof AppError) {
      redirect(`/dashboard/leads?${currentQuery}&error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; success?: string; error?: string }>;
}) {
  const { page: pageParam, status: statusParam, success, error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const page = Math.max(1, Number(pageParam) || 1);
  const status = statusParam && isLeadStatus(statusParam) ? statusParam : undefined;
  const currentQuery = new URLSearchParams({ page: String(page), ...(status ? { status } : {}) }).toString();

  const { leads, totalCount } = await listLeadsForOrg(organizationId, { status, page, pageSize: PAGE_SIZE });
  const supabase = (await import("@/infrastructure/supabase/server-client")).getSupabaseServiceClient();
  const { count: pendingFollowUps } = await supabase.from("automated_followups").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "pending");
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Clients</h1>
        <p className="mt-1 text-sm text-slate-500">Prospects et clients de votre pipeline commercial.</p>
      </div>

      {success && <p className="adm-alert-success">{success}</p>}
      {error && <p className="adm-alert-danger">{error}</p>}

      <section className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="adm-card bg-gradient-to-r from-violet-50 via-white to-white"><p className="adm-eyebrow">Relance intelligente</p><h2 className="mt-1 adm-heading-2 text-lg">24 h pour les plus engagés · 48 h pour les autres</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Le système s&apos;appuie d&apos;abord sur les signaux réellement observés et des messages sûrs. L&apos;IA intervient seulement en dernière position pour personnaliser une relance, sans décider qui doit être relancé.</p><div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-violet-100 px-3 py-1.5 font-semibold text-violet-700">Engagement élevé · 24 h</span><span className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-600">Engagement standard · 48 h</span><span className="rounded-full bg-emerald-100 px-3 py-1.5 font-semibold text-emerald-700">{pendingFollowUps ?? 0} relance(s) en attente</span></div></div>
        <div className="adm-kpi min-w-[170px]"><p className="adm-label">Automatisées</p><p className="mt-1 adm-value">Actif</p><p className="mt-1 text-xs adm-muted">Traitement périodique sécurisé</p></div>
      </section>

      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          href="/dashboard/leads"
          className={`rounded-full px-3 py-1 ${!status ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Tous
        </Link>
        {LEAD_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/dashboard/leads?status=${s}`}
            className={`rounded-full px-3 py-1 ${status === s ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)]">
        {leads.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Aucun prospect pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-navy-900/10 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2">Score IA</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-navy-900/5 last:border-0">
                  <td className="px-4 py-2">
                    <p>{lead.contactName ?? "Sans nom"}</p>
                    <p className="text-xs text-slate-500">{lead.contactPhone ?? "—"}</p>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[lead.status]}`}>
                      {STATUS_LABELS[lead.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2" title={lead.scoreReason ?? undefined}>
                    {lead.score ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{lead.source ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <form action={updateLeadStatusAction} className="flex items-center justify-end gap-2">
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="leadId" value={lead.id} />
                      <input type="hidden" name="currentQuery" value={currentQuery} />
                      <select name="status" defaultValue={lead.status} className="rounded-xl border border-navy-900/10 px-2 py-1 text-xs">
                        {LEAD_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      <SubmitButton pendingLabel="..." className="text-xs font-medium text-violet-600 hover:underline disabled:opacity-60">
                        OK
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>
            Page {page} sur {totalPages} — {totalCount} prospect{totalCount > 1 ? "s" : ""} au total
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/dashboard/leads?page=${page - 1}${status ? `&status=${status}` : ""}`}
                className="rounded-xl border border-navy-900/10 px-3 py-1.5 font-medium hover:border-navy-900/20"
              >
                Précédent
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/dashboard/leads?page=${page + 1}${status ? `&status=${status}` : ""}`}
                className="rounded-xl border border-navy-900/10 px-3 py-1.5 font-medium hover:border-navy-900/20"
              >
                Suivant
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}