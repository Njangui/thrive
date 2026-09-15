"use client";

import type { ConversationThreadMessage } from "@/application/services/conversation-admin-service";
import { SubmitButton } from "@/app/_components/submit-button";

const SENDER_STYLES: Record<string, string> = {
  contact: "self-start bg-white border border-navy-900/10",
  ai: "self-end bg-violet-50 text-navy-900",
  human: "self-end bg-navy-900 text-white",
};

/**
 * Ajustement Lot E, Partie 4 (audit) : `replyAction` est maintenant passée
 * DIRECTEMENT à `action` (au lieu d'être enveloppée dans une fonction
 * cliente qui n'attendait pas sa Promise) pour que `useFormStatus` — donc
 * `SubmitButton` — reflète correctement le round-trip serveur réel. Le
 * champ n'a plus besoin d'être contrôlé : un succès redirige vers la même
 * page (voir page.tsx), ce qui remonte le formulaire à l'état initial.
 */
export function ConversationThreadView({
  messages,
  replyAction,
  returnToAiAction,
  closeAction,
  disabled,
}: {
  messages: ConversationThreadMessage[];
  replyAction: (formData: FormData) => void;
  returnToAiAction: () => void;
  closeAction: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border border-navy-900/10 bg-[#F7F6FD] p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun message pour l&apos;instant.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${SENDER_STYLES[m.sender] ?? ""}`}
            >
              {m.content}
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={returnToAiAction}
          className="rounded-xl border border-navy-900/10 px-3 py-2 text-xs font-medium text-slate-500 hover:bg-navy-900/5"
        >
          Rendre à l&apos;IA
        </button>
        <button
          type="button"
          onClick={closeAction}
          className="rounded-xl border border-navy-900/10 px-3 py-2 text-xs font-medium text-slate-500 hover:bg-navy-900/5"
        >
          Clôturer
        </button>
      </div>

      <form action={replyAction} className="flex gap-2">
        <input
          name="content"
          required
          placeholder="Répondre..."
          disabled={disabled}
          className="flex-1 rounded-xl border border-navy-900/10 px-4 py-3 text-sm disabled:opacity-50"
        />
        <SubmitButton
          pendingLabel="Envoi..."
          disabled={disabled}
          className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          Envoyer
        </SubmitButton>
      </form>
    </div>
  );
}
