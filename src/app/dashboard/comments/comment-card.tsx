"use client";

import { useState, useTransition } from "react";
import { SubmitButton } from "@/app/_components/submit-button";
import { getCommentDraftSuggestionAction } from "./comments-actions";
import type { SocialCommentListItem } from "@/application/services/social-comment-service";

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
  twitter: "X (Twitter)",
  reddit: "Reddit",
  bluesky: "Bluesky",
};

const STATUS_STYLES: Record<string, string> = {
  new: "bg-clay/10 text-clay",
  replied: "bg-leaf/10 text-leaf",
  hidden: "bg-ink/10 text-muted",
};

const STATUS_LABELS: Record<string, string> = {
  new: "Nouveau",
  replied: "Répondu",
  hidden: "Masqué",
};

export function CommentCard({
  comment,
  organizationId,
  canHide,
  replyAction,
  hideAction,
  unhideAction,
}: {
  comment: SocialCommentListItem;
  organizationId: string;
  canHide: boolean;
  replyAction: (formData: FormData) => void;
  hideAction: (formData: FormData) => void;
  unhideAction: (formData: FormData) => void;
}) {
  const [draft, setDraft] = useState("");
  const [isSuggesting, startSuggesting] = useTransition();
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  function handleSuggest() {
    setSuggestionError(null);
    startSuggesting(async () => {
      const { suggestion } = await getCommentDraftSuggestionAction(organizationId, comment.content);
      if (suggestion) {
        setDraft(suggestion);
      } else {
        setSuggestionError("Suggestion indisponible pour le moment — répondez directement.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-brand border border-ink/10 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              {PLATFORM_LABELS[comment.platform] ?? comment.platform}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[comment.status] ?? ""}`}>
              {STATUS_LABELS[comment.status] ?? comment.status}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-ink">{comment.authorName ?? "Auteur inconnu"}</p>
          <p className="text-sm text-ink">{comment.content}</p>
          {comment.postContent && (
            <p className="mt-1 truncate text-xs text-muted">Sur : {comment.postContent}</p>
          )}
        </div>

        {canHide && (
          <form action={comment.status === "hidden" ? unhideAction : hideAction}>
            <input type="hidden" name="commentId" value={comment.id} />
            <SubmitButton
              pendingLabel="..."
              className="shrink-0 rounded-full border border-ink/15 px-2.5 py-1 text-xs font-medium text-muted hover:bg-ink/5"
            >
              {comment.status === "hidden" ? "Afficher" : "Masquer"}
            </SubmitButton>
          </form>
        )}
      </div>

      {comment.status === "replied" && comment.replyContent && (
        <div className="rounded-brand bg-leaf/5 px-3 py-2 text-sm text-ink">
          <p className="text-xs font-medium text-leaf">Votre réponse</p>
          {comment.replyContent}
        </div>
      )}

      {comment.status === "new" && (
        <form action={replyAction} className="flex flex-col gap-2">
          <input type="hidden" name="commentId" value={comment.id} />
          <textarea
            name="content"
            required
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Répondre à ce commentaire..."
            rows={2}
            className="rounded-brand border border-ink/15 px-3 py-2 text-sm"
          />
          {suggestionError && <p className="text-xs text-clay">{suggestionError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSuggest}
              disabled={isSuggesting}
              className="rounded-brand border border-ink/15 px-3 py-2 text-xs font-medium text-muted hover:bg-ink/5 disabled:opacity-60"
            >
              {isSuggesting ? "Génération..." : "Suggérer une réponse (IA)"}
            </button>
            <SubmitButton
              pendingLabel="Envoi..."
              className="ml-auto rounded-brand bg-leaf px-4 py-2 text-xs font-medium text-white disabled:opacity-60"
            >
              Envoyer
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
