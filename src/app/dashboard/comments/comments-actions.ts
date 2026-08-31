"use server";

import { requireMembership } from "@/application/services/auth-service";
import { draftCommentReplySuggestion } from "@/application/services/social-comment-service";

/**
 * Contrairement aux autres actions de /dashboard/comments (sync/reply/
 * hide), celle-ci n'est PAS liée à un `<form action={...}>` avec
 * redirect : elle est appelée directement depuis un clic client (voir
 * comment-card.tsx, `useTransition`) pour préremplir le champ de réponse
 * SANS recharger la page — le commerçant doit pouvoir relire/modifier la
 * suggestion avant de l'envoyer, jamais un envoi automatique.
 */
export async function getCommentDraftSuggestionAction(
  organizationId: string,
  commentContent: string,
): Promise<{ suggestion: string | null }> {
  try {
    await requireMembership(organizationId, ["owner", "admin"]);
  } catch {
    return { suggestion: null };
  }
  const suggestion = await draftCommentReplySuggestion(organizationId, commentContent);
  return { suggestion };
}
