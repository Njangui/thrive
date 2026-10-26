import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { getThreadMessages, listThreads } from "@/application/services/assistant-chat-service";
import { getAgentRuntime } from "@/infrastructure/agents/runtime-registry";
import { ChatClient } from "./chat-client";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const actor = await requireDashboardActor();
  const [threads, tools] = await Promise.all([listThreads(actor), getAgentRuntime().listVisibleTools(actor)]);
  const first = threads[0];
  const initialMessages = first ? await getThreadMessages(actor, first.id) : [];
  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-5xl flex-col">
      <ChatClient initialThreads={threads} initialMessages={initialMessages} tools={tools} role={actor.role} />
    </div>
  );
}
