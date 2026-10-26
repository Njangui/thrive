import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiAdapter, stripJsonFence } from "./gemini-adapter";

afterEach(() => vi.unstubAllGlobals());

describe("stripJsonFence", () => {
  it("retire la clôture ```json", () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe("GeminiAdapter", () => {
  it("appelle l'endpoint compatible OpenAI avec Bearer et renvoie les tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Salut" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await new GeminiAdapter("k", "gemini-2.5-flash").generateText({ systemPrompt: "s", userMessage: "u" });
    expect(out).toMatchObject({ text: "Salut", provider: "gemini", model: "gemini-2.5-flash", usage: { inputTokens: 10, outputTokens: 5 } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });
  it("analyse un JSON entouré de clôtures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"x":2}\n```' } }] }), { status: 200 })));
    const out = await new GeminiAdapter("k", "m").generateStructuredOutput<{ x: number }>({ systemPrompt: "s", userMessage: "u", outputSchemaDescription: "{}" });
    expect(out.data).toEqual({ x: 2 });
  });
  it("erreur HTTP → exception explicite", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 429 })));
    await expect(new GeminiAdapter("k", "m").generateText({ systemPrompt: "s", userMessage: "u" })).rejects.toThrow(/Gemini generateText failed \(429\)/);
  });
});
