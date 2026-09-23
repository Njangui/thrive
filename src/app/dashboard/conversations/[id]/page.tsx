import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import {
  getConversationThread,
  sendHumanReply,
  returnConversationToAI,
  takeOverConversation,
  closeConversation,
  type HumanReplyAttachment,
} from "@/application/services/conversation-admin-service";
import { uploadOutboundAttachment } from "@/application/services/message-attachment-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
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
    const fileEntry = formData.get("attachment");
    const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;
    const isVoiceNote = formData.get("isVoiceNote") === "1";
    try {
      let attachment: HumanReplyAttachment | undefined;
      if (file) {
        // Le canal décide des formats acceptés (WhatsApp est plus strict que
        // Telegram sur WebP/WebM) — on le lit sur la conversation elle-même,
        // jamais depuis le formulaire (valeur fournie par le client).
        const { data: conversationRow } = await getSupabaseServiceClient()
          .from("conversations")
          .select("channel")
          .eq("organization_id", organizationId)
          .eq("id", conversationId)
          .maybeSingle();
        const uploaded = await uploadOutboundAttachment(
          organizationId,
          file,
          conversationRow?.channel ?? "whatsapp",
          isVoiceNote,
        );
        attachment = {
          url: uploaded.url,
          type: uploaded.type,
          fileName: uploaded.fileName,
          mimeType: uploaded.mimeType,
          isVoiceNote: uploaded.isVoiceNote,
        };
      }
      await sendHumanReply(organizationId, conversationId, content, membership.userId, attachment);
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
    try {
      await returnConversationToAI(organizationId, conversationId);
    } catch (err) {
      redirect(`/dashboard/conversations/${conversationId}?error=${encodeURIComponent(err instanceof AppError ? err.message : "Impossible de rendre la main à l'IA.")}`);
    }
    redirect(`/dashboard/conversations/${conversationId}`);
  }

  /** Lot P — bouton « Prendre la main » : met l'IA en pause sans avoir à écrire un message tout de suite. */
  async function takeOverAction() {
    "use server";
    const membership = await requireMembership(organizationId, ["owner", "admin", "manager", "sales"]);
    try {
      await takeOverConversation(organizationId, conversationId, membership.userId);
    } catch (err) {
      redirect(`/dashboard/conversations/${conversationId}?error=${encodeURIComponent(err instanceof AppError ? err.message : "Impossible de prendre la main sur la conversation.")}`);
    }
    redirect(`/dashboard/conversations/${conversationId}`);
  }

  async function closeAction() {
    "use server";
    await requireMembership(organizationId, ["owner", "admin", "manager", "sales"]);
    try {
      await closeConversation(organizationId, conversationId);
    } catch (err) {
      redirect(`/dashboard/conversations/${conversationId}?error=${encodeURIComponent(err instanceof AppError ? err.message : "Impossible de clôturer la conversation.")}`);
    }
    redirect("/dashboard/conversations");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-slate-500">Conversation avec</p>
        <h1 className="font-jakarta text-xl font-bold">{thread.contactName ?? thread.contactPhone ?? "Contact"}</h1>
      </div>

      {error && (
        <p className="adm-alert-danger">{error}</p>
      )}

      <ConversationThreadView
        messages={thread.messages}
        replyAction={replyAction}
        returnToAiAction={returnToAiAction}
        takeOverAction={takeOverAction}
        closeAction={closeAction}
        disabled={thread.handoffStatus === "resolved"}
        handoffStatus={thread.handoffStatus}
        handoffReasonLabel={thread.handoffReasonLabel}
        aiResumeAt={thread.aiResumeAt}
      />
    </div>
  );
}
