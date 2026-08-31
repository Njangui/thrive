import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { listConversationsForOrg } from "@/application/services/conversation-admin-service";

const STATUS_STYLES: Record<string, string> = {
  pending_human: "bg-clay/10 text-clay",
  human: "bg-amber-100 text-amber-800",
  ai: "bg-leaf/10 text-leaf",
  resolved: "bg-ink/10 text-muted",
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
      <h1 className="font-display text-2xl font-bold tracking-tight">Conversations</h1>

      {conversations.length === 0 ? (
        <p className="text-sm text-muted">Aucune conversation pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/conversations/${c.id}`}
              className="flex items-center justify-between rounded-brand border border-ink/10 bg-white px-4 py-3 hover:border-leaf/40"
            >
              <div>
                <p className="text-sm font-medium">{c.contactName ?? c.contactPhone ?? "Contact inconnu"}</p>
                {c.handoffReason && <p className="text-xs text-muted">{c.handoffReason}</p>}
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
