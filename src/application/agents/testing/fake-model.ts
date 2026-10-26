/** Fournisseur IA scripté pour tester le runtime sans réseau. */
import type { AIChatRequest, AIChatResponse, AIProvider, AIToolCall } from "@/domain/ports/ai-provider";
import type { ModelRouter } from "../runtime";

export type ScriptedTurn = Partial<AIChatResponse> | Error | ((request: AIChatRequest) => Partial<AIChatResponse>);

export class ScriptedProvider implements AIProvider {
  readonly requests: AIChatRequest[] = [];
  private index = 0;
  constructor(public readonly providerName: string, private readonly script: ScriptedTurn[]) {}

  async generateText(): Promise<never> { throw new Error("non utilisé"); }
  async generateStructuredOutput(): Promise<never> { throw new Error("non utilisé"); }
  async classify(): Promise<never> { throw new Error("non utilisé"); }

  async chat(request: AIChatRequest): Promise<AIChatResponse> {
    this.requests.push(structuredClone(request));
    const turn = this.script[Math.min(this.index++, this.script.length - 1)];
    if (turn instanceof Error) throw turn;
    const partial = typeof turn === "function" ? turn(request) : turn ?? {};
    return {
      text: "", toolCalls: [], finishReason: partial.toolCalls?.length ? "tool_calls" : "stop",
      provider: this.providerName, model: `${this.providerName}-model`, usage: { inputTokens: 10, outputTokens: 5 },
      ...partial,
    };
  }
}

export const toolCall = (name: string, args: unknown, id = `call-${Math.random().toString(36).slice(2, 8)}`): AIToolCall => ({ id, name, arguments: args });

export function fixedModels(primary: AIProvider, fallback: AIProvider | null = null): ModelRouter & { calls: Array<{ tenantId: string; tier: string }> } {
  const calls: Array<{ tenantId: string; tier: string }> = [];
  return { calls, forTier: async (tenantId, tier) => { calls.push({ tenantId, tier }); return { primary, fallback }; } };
}
