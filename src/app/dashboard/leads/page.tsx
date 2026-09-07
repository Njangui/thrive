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
  visitor: "bg-ink/10 text-muted",
  lead: "bg-ink/10 text-ink",
  qualified: "bg-amber-500/10 text-amber-600",
  opportunity: "bg-amber-500/10 text-amber-600",
  customer: "bg-leaf/10 text-leaf",
  lost: "bg-clay/10 text-clay",
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
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Clients</h1>
        <p className="mt-1 text-sm text-muted">Prospects et clients de votre pipeline commercial.</p>
      </div>

      {success && <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>}
      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}

      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          href="/dashboard/leads"
          className={`rounded-full px-3 py-1 ${!status ? "bg-ink text-white" : "bg-ink/10 text-muted"}`}
        >
          Tous
        </Link>
        {LEAD_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/dashboard/leads?status=${s}`}
            className={`rounded-full px-3 py-1 ${status === s ? "bg-ink text-white" : "bg-ink/10 text-muted"}`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-brand border border-ink/10 bg-white">
        {leads.length === 0 ? (
          <p className="p-6 text-sm text-muted">Aucun prospect pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
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
                <tr key={lead.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-2">
                    <p>{lead.contactName ?? "Sans nom"}</p>
                    <p className="text-xs text-muted">{lead.contactPhone ?? "—"}</p>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[lead.status]}`}>
                      {STATUS_LABELS[lead.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2" title={lead.scoreReason ?? undefined}>
                    {lead.score ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-muted">{lead.source ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <form action={updateLeadStatusAction} className="flex items-center justify-end gap-2">
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="leadId" value={lead.id} />
                      <input type="hidden" name="currentQuery" value={currentQuery} />
                      <select name="status" defaultValue={lead.status} className="rounded-brand border border-ink/15 px-2 py-1 text-xs">
                        {LEAD_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      <SubmitButton pendingLabel="..." className="text-xs font-medium text-leaf hover:underline disabled:opacity-60">
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
        <div className="flex items-center justify-between text-sm text-muted">
          <p>
            Page {page} sur {totalPages} — {totalCount} prospect{totalCount > 1 ? "s" : ""} au total
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/dashboard/leads?page=${page - 1}${status ? `&status=${status}` : ""}`}
                className="rounded-brand border border-ink/15 px-3 py-1.5 font-medium hover:border-ink/30"
              >
                Précédent
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/dashboard/leads?page=${page + 1}${status ? `&status=${status}` : ""}`}
                className="rounded-brand border border-ink/15 px-3 py-1.5 font-medium hover:border-ink/30"
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
