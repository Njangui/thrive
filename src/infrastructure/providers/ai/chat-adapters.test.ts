import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIChatRequest } from "@/domain/ports/ai-provider";
import { ClaudeAdapter } from "./claude-adapter";
import { MistralAdapter } from "./mistral-adapter";
import { OpenAIAdapter } from "./openai-adapter";

const request: AIChatRequest = {
  systemPrompt: "Tu es un agent.",
  messages: [
    { role: "user", content: "Change le prix" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "catalog__update_price", arguments: { price: 5 } }, { id: "c2", name: "catalog__list", arguments: {} }] },
    { role: "tool", toolCallId: "c1", name: "catalog__update_price", content: "ok" },
    { role: "tool", toolCallId: "c2", name: "catalog__list", content: "[]" },
  ],
  tools: [{ name: "catalog__list", description: "Liste", parameters: { type: "object", properties: {} } }],
};

function stubFetch(body: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => "boom" }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const sent = (fn: ReturnType<typeof stubFetch>) => JSON.parse((fn.mock.calls[0] as unknown as [string, { body: string }])[1].body);

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ["Mistral", (key: string) => new MistralAdapter(key, "m")],
  ["OpenAI", (key: string) => new OpenAIAdapter(key, "m")],
])("%s chat() — format chat completions", (_label, make) => {
  it("envoie outils + messages d'outils, relit les appels d'outils (JSON illisible signalé)", async () => {
    const fn = stubFetch({
      choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [
        { id: "a", function: { name: "catalog__list", arguments: '{"limit":3}' } },
        { id: "b", function: { name: "catalog__list", arguments: "{pas du json" } },
      ] } }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });
    const out = await make("k").chat!(request);
    const body = sent(fn);
    expect(body.tools[0].function.name).toBe("catalog__list");
    expect(body.tool_choice).toBe("auto");
    expect(body.messages[2].tool_calls[0].function.arguments).toBe('{"price":5}');
    expect(body.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c2" });
    expect(out.finishReason).toBe("tool_calls");
    expect(out.toolCalls[0]).toEqual({ id: "a", name: "catalog__list", arguments: { limit: 3 } });
    expect(out.toolCalls[1]?.argumentsError).toBeDefined();
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  it("réponse texte simple ; erreur HTTP => exception", async () => {
    stubFetch({ choices: [{ finish_reason: "stop", message: { content: "Bonjour" } }] });
    expect((await make("k").chat!({ systemPrompt: "s", messages: [{ role: "user", content: "hi" }] })).text).toBe("Bonjour");
    stubFetch({}, false);
    await expect(make("k").chat!({ systemPrompt: "s", messages: [] })).rejects.toThrow(/chat failed/);
  });
});

describe("Claude chat() — tool_use / tool_result", () => {
  it("fusionne les résultats d'outils consécutifs dans un seul message user", async () => {
    const fn = stubFetch({
      stop_reason: "tool_use",
      content: [{ type: "text", text: "Je regarde" }, { type: "tool_use", id: "t1", name: "catalog__list", input: { limit: 2 } }],
      usage: { input_tokens: 7, output_tokens: 3 },
    });
    const out = await new ClaudeAdapter("k", "m").chat!(request);
    const body = sent(fn);
    expect(body.tools[0].input_schema).toEqual({ type: "object", properties: {} });
    const last = body.messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content.map((b: { tool_use_id: string }) => b.tool_use_id)).toEqual(["c1", "c2"]);
    expect(body.messages[1].content[0]).toMatchObject({ type: "tool_use", id: "c1", input: { price: 5 } });
    expect(out).toMatchObject({ text: "Je regarde", finishReason: "tool_calls", toolCalls: [{ id: "t1", name: "catalog__list", arguments: { limit: 2 } }] });
  });
});
