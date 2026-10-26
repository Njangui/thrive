import type { AIChatMessage, AIChatRequest, AIChatResponse, AIToolCall } from "@/domain/ports/ai-provider";

/**
 * Conversation à outils au format « chat completions » (Mistral et OpenAI
 * partagent ce format). Aucun SDK : `fetch` comme les autres adapters.
 */
export function toOpenAIMessages(request: AIChatRequest): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [{ role: "system", content: request.systemPrompt }];
  for (const message of request.messages as AIChatMessage[]) {
    if (message.role === "user") {
      messages.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      messages.push({
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      messages.push({ role: "tool", tool_call_id: message.toolCallId, name: message.name, content: message.content });
    }
  }
  return messages;
}

function parseToolCalls(raw: unknown): AIToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => {
    const call = entry as { id?: string; function?: { name?: string; arguments?: unknown } };
    const id = call.id ?? `call_${index}`;
    const name = call.function?.name ?? "";
    const args = call.function?.arguments;
    if (typeof args === "object" && args !== null) return { id, name, arguments: args };
    try {
      return { id, name, arguments: JSON.parse(typeof args === "string" && args.trim() ? args : "{}") };
    } catch {
      return { id, name, argumentsError: "arguments JSON illisibles" };
    }
  });
}

const FINISH: Record<string, AIChatResponse["finishReason"]> = {
  stop: "stop",
  tool_calls: "tool_calls",
  length: "length",
  model_length: "length",
};

export async function openAICompatibleChat(args: {
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  request: AIChatRequest;
}): Promise<AIChatResponse> {
  const { request } = args;
  const res = await fetch(`${args.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      messages: toOpenAIMessages(request),
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.2,
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            })),
            tool_choice: "auto",
          }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(`${args.label} chat failed (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  const toolCalls = parseToolCalls(choice?.message?.tool_calls);
  return {
    text: typeof content === "string" ? content : "",
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : (FINISH[choice?.finish_reason as string] ?? "other"),
    provider: args.label.toLowerCase(),
    model: args.model,
    usage: data.usage ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } : undefined,
  };
}
