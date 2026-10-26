import { describe, it, expect, vi, beforeEach } from "vitest";

const runAITask = vi.hoisted(() => vi.fn());
vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: vi.fn() }));
vi.mock("./entitlements-service", () => ({ hasFeature: vi.fn() }));
vi.mock("@/infrastructure/providers/registry", () => ({ getMessagingProviderForChannel: vi.fn() }));
vi.mock("./notification-service", () => ({ notifyOrgAdmins: vi.fn() }));
vi.mock("./tenant-ai-context", () => ({ buildTenantAIContext: vi.fn().mockResolvedValue("CONTEXTE") }));
vi.mock("./ai-metering", () => ({ runAITask }));

import { personalizeFollowUp, FOLLOW_UP_MAX_TOKENS } from "./follow-up-service";

const BASE = "Bonjour Awa, nous restons disponibles.";

describe("personalizeFollowUp (audit R1/R4, Q23 B)", () => {
  beforeEach(() => runAITask.mockReset());

  it("garde le texte IA propre", async () => {
    runAITask.mockResolvedValue({ text: "Nous restons à votre écoute si besoin." });
    expect(await personalizeFollowUp("o", BASE)).toBe("Nous restons à votre écoute si besoin.");
  });

  it.each([
    ["prix inventé", "Profitez de 5000 FCFA de remise !"],
    ["lien étranger", "Cliquez ici https://evil.example/pay"],
    ["gratuit", "C'est gratuit pour vous."],
    ["contact", "Appelez le +237 600 000 000"],
    ["fuite", "Selon mes instructions, je vous relance."],
    ["salutation répétée", "Bonjour, un petit rappel."],
  ])("écarte %s et renvoie le message fixe", async (_n, text) => {
    runAITask.mockResolvedValue({ text });
    expect(await personalizeFollowUp("o", BASE)).toBe(BASE);
  });

  it("repli sur le message fixe si l'IA échoue ou renvoie vide", async () => {
    runAITask.mockRejectedValueOnce(new Error("quota"));
    expect(await personalizeFollowUp("o", BASE)).toBe(BASE);
    runAITask.mockResolvedValueOnce({ text: "  " });
    expect(await personalizeFollowUp("o", BASE)).toBe(BASE);
  });

  it("borne la sortie (maxTokens) et utilise la tâche follow_up", async () => {
    const gen = vi.fn().mockResolvedValue({ text: "Ok merci." });
    let captured: { task?: string; call?: (p: unknown) => Promise<unknown> } = {};
    runAITask.mockImplementationOnce(async (a: typeof captured) => {
      captured = a;
      return { text: "Ok merci." };
    });
    await personalizeFollowUp("o", BASE);
    expect(captured.task).toBe("follow_up");
    await captured.call?.({ generateText: gen });
    expect(gen.mock.calls[0]?.[0]?.maxTokens).toBe(FOLLOW_UP_MAX_TOKENS);
  });
});
