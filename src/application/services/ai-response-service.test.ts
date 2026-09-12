import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAIProvider = vi.fn();
vi.mock("@/infrastructure/providers/registry", () => ({
  getAIProvider: (...args: unknown[]) => mockGetAIProvider(...args),
}));

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

vi.mock("./tenant-ai-context", () => ({
  buildTenantAIContext: vi.fn().mockResolvedValue("system prompt"),
}));

const mockConsumeCredit = vi.fn();
const mockReleaseCredit = vi.fn();
vi.mock("./ai-credits-service", () => ({
  consumeCredit: (...args: unknown[]) => mockConsumeCredit(...args),
  releaseCredit: (...args: unknown[]) => mockReleaseCredit(...args),
}));

import { generateAIReply } from "./ai-response-service";

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ insert: () => Promise.resolve({ error: null }) });
});

describe("generateAIReply — Lot 3 (réservation atomique avant génération, jamais un check-then-act)", () => {
  it("solde épuisé : lève QuotaExceededError SANS jamais appeler le provider IA (aucun coût engagé)", async () => {
    mockConsumeCredit.mockResolvedValue({ success: false });

    await expect(generateAIReply("org-1", "Bonjour")).rejects.toThrow(/Crédits IA épuisés/);
    expect(mockGetAIProvider).not.toHaveBeenCalled();
  });

  it("succès (primary) : réserve un crédit, ne rembourse jamais", async () => {
    mockConsumeCredit.mockResolvedValue({ success: true });
    const generateText = vi.fn().mockResolvedValue({ text: "Réponse", provider: "mistral", model: "m" });
    mockGetAIProvider.mockResolvedValue({ primary: { providerName: "mistral", generateText }, fallback: null });

    const result = await generateAIReply("org-1", "Bonjour");

    expect(result.text).toBe("Réponse");
    expect(mockConsumeCredit).toHaveBeenCalledWith("org-1");
    expect(mockReleaseCredit).not.toHaveBeenCalled();
  });

  it("primary échoue, fallback réussit : ne rembourse pas (une génération a réellement eu lieu)", async () => {
    mockConsumeCredit.mockResolvedValue({ success: true });
    const primaryGenerateText = vi.fn().mockRejectedValue(new Error("primary indisponible"));
    const fallbackGenerateText = vi.fn().mockResolvedValue({ text: "Réponse de secours", provider: "claude", model: "m" });
    mockGetAIProvider.mockResolvedValue({
      primary: { providerName: "mistral", generateText: primaryGenerateText },
      fallback: { providerName: "claude", generateText: fallbackGenerateText },
    });

    const result = await generateAIReply("org-1", "Bonjour");

    expect(result.text).toBe("Réponse de secours");
    expect(mockReleaseCredit).not.toHaveBeenCalled();
  });

  it("critère d'acceptation (section 30) : primary ET fallback échouent -> rembourse le crédit réservé, ne consomme jamais pour une génération qui n'a pas eu lieu", async () => {
    mockConsumeCredit.mockResolvedValue({ success: true });
    const primaryGenerateText = vi.fn().mockRejectedValue(new Error("primary indisponible"));
    const fallbackGenerateText = vi.fn().mockRejectedValue(new Error("fallback aussi indisponible"));
    mockGetAIProvider.mockResolvedValue({
      primary: { providerName: "mistral", generateText: primaryGenerateText },
      fallback: { providerName: "claude", generateText: fallbackGenerateText },
    });

    await expect(generateAIReply("org-1", "Bonjour")).rejects.toThrow(/fallback aussi indisponible/);
    expect(mockReleaseCredit).toHaveBeenCalledWith("org-1");
  });

  it("sans fallback configuré, primary échoue : rembourse et propage l'erreur d'origine", async () => {
    mockConsumeCredit.mockResolvedValue({ success: true });
    const primaryGenerateText = vi.fn().mockRejectedValue(new Error("seul provider en échec"));
    mockGetAIProvider.mockResolvedValue({ primary: { providerName: "mistral", generateText: primaryGenerateText }, fallback: null });

    await expect(generateAIReply("org-1", "Bonjour")).rejects.toThrow(/seul provider en échec/);
    expect(mockReleaseCredit).toHaveBeenCalledWith("org-1");
  });
});
