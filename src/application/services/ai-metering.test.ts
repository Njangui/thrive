import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAIProvider = vi.fn();
vi.mock("@/infrastructure/providers/registry", () => ({ getAIProvider: (...a: unknown[]) => mockGetAIProvider(...a) }));
const insert = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({ from: () => ({ insert }) }) }));
const mockConsume = vi.fn();
const mockRelease = vi.fn();
vi.mock("./ai-credits-service", () => ({ consumeCredit: (...a: unknown[]) => mockConsume(...a), releaseCredit: (...a: unknown[]) => mockRelease(...a) }));

import { runAITask } from "./ai-metering";

const resp = (input: number, output: number) => ({ text: "ok", provider: "gemini", model: "gemini-2.5-flash", usage: { inputTokens: input, outputTokens: output } });

beforeEach(() => {
  vi.clearAllMocks();
  mockConsume.mockResolvedValue({ success: true });
  insert.mockResolvedValue({ error: null });
});

describe("runAITask — crédits selon la tâche", () => {
  it("analyse : niveau complexe demandé au routeur, 3 crédits réservés, tokens journalisés", async () => {
    mockGetAIProvider.mockResolvedValue({ primary: { providerName: "gemini" }, fallback: null });
    const out = await runAITask({ organizationId: "o", task: "analysis", call: async () => resp(500, 300) });
    expect(out.text).toBe("ok");
    expect(mockGetAIProvider).toHaveBeenCalledWith("o", "complex");
    expect(mockConsume).toHaveBeenCalledWith("o", 3, "ai_analysis", { task: "analysis", tier: "complex" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ task: "analysis", tier: "complex", input_tokens: 500, output_tokens: 300, credits_charged: 3 }));
  });

  it("réponse client : niveau simple, 1 crédit", async () => {
    mockGetAIProvider.mockResolvedValue({ primary: { providerName: "mistral" }, fallback: null });
    await runAITask({ organizationId: "o", task: "customer_reply", call: async () => resp(10, 10) });
    expect(mockGetAIProvider).toHaveBeenCalledWith("o", "simple");
    expect(mockConsume).toHaveBeenCalledWith("o", 1, "ai_customer_reply", { task: "customer_reply", tier: "simple" });
  });

  it("gros volume de tokens : supplément facturé après coup", async () => {
    mockGetAIProvider.mockResolvedValue({ primary: { providerName: "gemini" }, fallback: null });
    await runAITask({ organizationId: "o", task: "report", call: async () => resp(9000, 3000) }); // 12 000 tokens → +2
    expect(mockConsume).toHaveBeenNthCalledWith(1, "o", 5, "ai_report", expect.any(Object));
    expect(mockConsume).toHaveBeenNthCalledWith(2, "o", 2, "ai_report_tokens", { totalTokens: 12000 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ credits_charged: 7 }));
  });

  it("solde épuisé : aucune génération", async () => {
    mockGetAIProvider.mockResolvedValue({ primary: { providerName: "gemini" }, fallback: null });
    mockConsume.mockResolvedValue({ success: false });
    const call = vi.fn();
    await expect(runAITask({ organizationId: "o", task: "analysis", call })).rejects.toThrow(/Crédits IA épuisés/);
    expect(call).not.toHaveBeenCalled();
  });

  it("échec primaire → repli ; échec total → crédits de la tâche remboursés", async () => {
    const fallbackProvider = { providerName: "mistral" };
    mockGetAIProvider.mockResolvedValue({ primary: { providerName: "gemini" }, fallback: fallbackProvider });
    const ok = await runAITask({ organizationId: "o", task: "analysis", call: async (p) => { if (p.providerName === "gemini") throw new Error("429"); return resp(1, 1); } });
    expect(ok.text).toBe("ok");
    expect(mockRelease).not.toHaveBeenCalled();

    await expect(runAITask({ organizationId: "o", task: "analysis", call: async () => { throw new Error("down"); } })).rejects.toThrow("down");
    expect(mockRelease).toHaveBeenCalledWith("o", 3);
  });

  it("IA non activée : rien n'est réservé", async () => {
    mockGetAIProvider.mockRejectedValue(new Error("AI non activée"));
    await expect(runAITask({ organizationId: "o", task: "analysis", call: vi.fn() })).rejects.toThrow(/AI non activée/);
    expect(mockConsume).not.toHaveBeenCalled();
  });
});
