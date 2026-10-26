/**
 * Livraison du résultat d'une tâche planifiée : un message dans le fil « Tâches planifiées » du créateur (texte + cartes de
 * validation, approuvables comme dans le chat), et une notification quand une validation est attendue.
 * Le texte du modèle est stocké tel quel et rendu en texte brut par le chat (jamais interprété comme du HTML).
 */
import type { Actor } from "@/application/agents/contracts";
import type { ScheduledTaskRow } from "@/application/agents/scheduler";
import { appendAssistantMessage, getOrCreateChannelThread, type ChatPart } from "@/application/services/assistant-chat-service";
import { notifyOrgAdmins } from "@/application/services/notification-service";
import type { AgentActor } from "@/application/channels/actor";
import type { ApprovalCard } from "@/domain/ports/agent-runtime-port";

export const SCHEDULED_THREAD_TITLE = "Tâches planifiées";

export interface DeliveryDeps {
  getThread: typeof getOrCreateChannelThread;
  append: typeof appendAssistantMessage;
  notify: typeof notifyOrgAdmins;
}
const defaults: DeliveryDeps = { getThread: getOrCreateChannelThread, append: appendAssistantMessage, notify: notifyOrgAdmins };

export async function deliverScheduledResult(
  task: Pick<ScheduledTaskRow, "id" | "tenantId" | "title">,
  creator: Actor,
  result: { text?: string; cards?: ApprovalCard[]; runId?: string },
  deps: DeliveryDeps = defaults,
): Promise<void> {
  const cards = result.cards ?? [];
  const text = (result.text ?? "").trim();
  if (!text && cards.length === 0) return;
  if (!creator.membershipId || creator.channel === "customer") return;
  const actor: AgentActor = { userId: creator.userId, tenantId: creator.tenantId, membershipId: creator.membershipId, role: creator.role, extraPermissions: creator.extraPermissions, channel: "dashboard" };
  const thread = await deps.getThread(actor, SCHEDULED_THREAD_TITLE);
  const parts: ChatPart[] = cards.map((card) => ({ type: "approval", card, state: "pending" }));
  const heading = task.title ?? "Tâche planifiée";
  await deps.append(actor, thread.id, { content: `${heading}\n\n${text || "Une action attend votre validation."}`, parts, runId: result.runId });
  if (cards.length > 0) {
    await deps.notify({
      organizationId: task.tenantId, title: `${heading} : validation attendue`,
      body: `${cards.length} action(s) attendent votre validation dans l'assistant (fil « ${SCHEDULED_THREAD_TITLE} »).`,
      relatedEntityType: "scheduled_task", relatedEntityId: task.id, priority: "important",
    });
  }
}
