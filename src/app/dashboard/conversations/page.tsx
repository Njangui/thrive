import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { listConversationsForOrg } from "@/application/services/conversation-admin-service";

const STATUS_STYLES: Record<string, string> = {
  pending_human: "bg-danger-50 text-danger-700",
  human: "bg-amber-100 text-amber-800",
  ai: "bg-violet-50 text-violet-700",
  resolved: "bg-slate-100 text-slate-600",
};

const STATUS_LABELS: Record<string, string> = {
  pending_human: "À traiter",
  human: "Pris en charge",
  ai: "IA active",
  resolved: "Clôturée",
};

export default async function ConversationsPage() {
  const { organizationId } = await requireCurrentOrganization();
  const conversations = await listConversationsForOrg(organizationId);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-jakarta text-2xl font-bold tracking-tight">Conversations</h1>

      {conversations.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune conversation pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/conversations/${c.id}`}
              className="flex items-center justify-between rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] px-4 py-3 hover:border-violet-300"
            >
              <div>
                <p className="text-sm font-medium">{c.contactName ?? c.contactPhone ?? "Contact inconnu"}</p>
                {c.handoffReason && <p className="text-xs text-slate-500">{c.handoffReason}</p>}
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[c.handoffStatus] ?? ""}`}>
                {STATUS_LABELS[c.handoffStatus] ?? c.handoffStatus}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
