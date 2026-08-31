import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

// createOrganization dépend aussi de la session Supabase et de plusieurs
// autres services (finance, plans, crédits IA) non pertinents pour ces
// tests, qui ciblent uniquement la progression d'onboarding (Lot I) —
// mockés au minimum pour permettre l'import du module sans erreur.
vi.mock("@/infrastructure/supabase/server-session-client", () => ({
  getSupabaseServerSessionClient: vi.fn(),
}));
vi.mock("./finance-service", () => ({ seedDefaultExpenseCategories: vi.fn() }));
vi.mock("./plans-repository", () => ({ createTrialSubscription: vi.fn() }));
vi.mock("./ai-credits-service", () => ({ initializeCreditBalance: vi.fn() }));

import { updateOnboardingStep, markOnboardingComplete, getOnboardingStatus } from "./onboarding-service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateOnboardingStep", () => {
  it("met à jour onboarding_step pour l'organisation donnée", async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    const update = vi.fn(() => ({ eq }));
    mockFrom.mockReturnValue({ update });

    await updateOnboardingStep("org-1", 3);

    expect(mockFrom).toHaveBeenCalledWith("organizations");
    expect(update).toHaveBeenCalledWith({ onboarding_step: 3 });
    expect(eq).toHaveBeenCalledWith("id", "org-1");
  });

  it("lève une erreur explicite si l'écriture échoue", async () => {
    mockFrom.mockReturnValue({ update: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) });

    await expect(updateOnboardingStep("org-1", 3)).rejects.toThrow(/progression de l'onboarding/);
  });
});

describe("markOnboardingComplete", () => {
  it("renseigne onboarding_completed_at avec un timestamp ISO", async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    const update = vi.fn((_payload: { onboarding_completed_at: string }) => ({ eq }));
    mockFrom.mockReturnValue({ update });

    await markOnboardingComplete("org-1");

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0]![0];
    expect(new Date(payload.onboarding_completed_at).toString()).not.toBe("Invalid Date");
  });

  it("lève une erreur explicite si l'écriture échoue", async () => {
    mockFrom.mockReturnValue({ update: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) });

    await expect(markOnboardingComplete("org-1")).rejects.toThrow(/finaliser l'onboarding/);
  });
});

describe("getOnboardingStatus", () => {
  it("retourne l'étape et la date de complétion telles que stockées", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { onboarding_step: 4, onboarding_completed_at: null }, error: null }),
        }),
      }),
    });

    const status = await getOnboardingStatus("org-1");
    expect(status).toEqual({ step: 4, completedAt: null });
  });

  it("retourne un état 'jamais commencé' sans lever si la lecture échoue (jamais de crash de navigation)", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }),
    });

    const status = await getOnboardingStatus("org-1");
    expect(status).toEqual({ step: 0, completedAt: null });
  });

  it("retourne 0 si onboarding_step est null (organisation antérieure à la migration)", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { onboarding_step: null, onboarding_completed_at: null }, error: null }),
        }),
      }),
    });

    const status = await getOnboardingStatus("org-1");
    expect(status.step).toBe(0);
  });
});
