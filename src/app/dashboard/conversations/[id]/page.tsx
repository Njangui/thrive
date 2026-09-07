import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import {
  getConversationThread,
  sendHumanReply,
  returnConversationToAI,
  closeConversation,
} from "@/application/services/conversation-admin-service";
import { AppError } from "@/lib/errors";
import { ConversationThreadView } from "./conversation-thread-view";

export default async function ConversationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id: conversationId } = await params;
  const { error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const thread = await getConversationThread(organizationId, conversationId);

  async function replyAction(formData: FormData) {
    "use server";
    const membership = await requireMembership(organizationId, ["owner", "admin", "manager", "sales"]);
    const content = String(formData.get("content") ?? "");
    try {
      await sendHumanReply(organizationId, conversationId, content, membership.userId);
    } catch (err) {
      // Ajustement Lot E, Partie 4 (audit) : l'erreur était avalée
      // silencieusement (console.error côté serveur uniquement) — le
      // commerçant ne savait jamais qu'un envoi avait échoué. Même
      // pattern `?error=` que le reste du dashboard.
      const message = err instanceof AppError ? err.message : "Erreur lors de l'envoi de la réponse.";
      redirect(`/dashboard/conversations/${conversationId}?error=${encodeURIComponent(message)}`);
    }
    redirect(`/dashboard/conversations/${conversationId}`);
  }

  async function returnToAiAction() {
    "use server";
    await requireMembership(organizationId, ["owner", "admin", "manager", "sales"]);
    await returnConversationToAI(organizationId, conversationId);
    redirect(`/dashboard/conversations/${conversationId}`);
  }

  async function closeAction() {
    "use server";
    await requireMembership(organizationId, ["owner", "admin", "manager", "sales"]);
    await closeConversation(organizationId, conversationId);
    redirect("/dashboard/conversations");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-muted">Conversation avec</p>
        <h1 className="font-display text-xl font-bold">{thread.contactName ?? thread.contactPhone ?? "Contact"}</h1>
      </div>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}

      <ConversationThreadView
        messages={thread.messages}
        replyAction={replyAction}
        returnToAiAction={returnToAiAction}
        closeAction={closeAction}
        disabled={thread.handoffStatus === "resolved"}
      />
    </div>
  );
}
