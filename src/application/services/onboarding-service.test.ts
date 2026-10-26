import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

// createOrganization dépend aussi de la session Supabase et de plusieurs
// autres services (finance, plans, crédits IA) non pertinents pour ces
// tests, qui ciblent uniquement la progression d'onboarding (Lot I) —
// mockés au minimum pour permettre l'import du module sans erreur.
vi.mock("@/infrastructure/supabase/server-session-client", () => ({
  getSupabaseServerSessionClient: vi.fn(),
}));
vi.mock("./finance-service", () => ({ seedDefaultExpenseCategories: vi.fn() }));
vi.mock("./country-service", () => ({ validateCountryForSignup: vi.fn() }));

import { updateOnboardingStep, markOnboardingComplete, getOnboardingStatus, createOrganization } from "./onboarding-service";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { validateCountryForSignup } from "./country-service";
import { ValidationError, AuthenticationError } from "@/lib/errors";

const mockGetSupabaseServerSessionClient = vi.mocked(getSupabaseServerSessionClient);
const mockValidateCountryForSignup = vi.mocked(validateCountryForSignup);

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

describe("createOrganization — Country Engine (section 12/13)", () => {
  function configureFrom() {
    const rpcCalls: Record<string, unknown>[] = [];
    mockRpc.mockImplementation(async (_fn: string, args: Record<string, unknown>) => {
      rpcCalls.push(args);
      return { data: "org-1", error: null };
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "categories") {
        // seedDefaultCategories : vérifie d'abord qu'aucune catégorie
        // n'existe déjà (compte à 0 ici), puis insère le preset par défaut.
        return {
          select: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }),
          insert: () => Promise.resolve({ error: null }),
        };
      }
      // generateUniqueSlug : le slug demandé n'est jamais déjà pris ; autres lectures : rien.
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    });

    return { insertedOrgs: rpcCalls };
  }

  function mockAuthenticatedSession(userId = "user-1") {
    mockGetSupabaseServerSessionClient.mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: userId } } }) },
    } as never);
  }

  it("rejette un pays invalide AVANT toute vérification de session ou écriture DB", async () => {
    mockValidateCountryForSignup.mockRejectedValue(new ValidationError("Ghana arrive bientôt sur Flexco."));

    await expect(createOrganization({ name: "Ma Boutique", countryCode: "GH" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockGetSupabaseServerSessionClient).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejette un nom vide avant même de valider le pays", async () => {
    await expect(createOrganization({ name: "   ", countryCode: "CM" })).rejects.toBeInstanceOf(ValidationError);
    expect(mockValidateCountryForSignup).not.toHaveBeenCalled();
  });

  it("exige une session authentifiée", async () => {
    mockValidateCountryForSignup.mockResolvedValue({ countryCode: "CM", currencyCode: "XAF" });
    mockGetSupabaseServerSessionClient.mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    } as never);

    await expect(createOrganization({ name: "Ma Boutique", countryCode: "CM" })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("dérive currency/country_code EXCLUSIVEMENT du pays validé, jamais d'un champ libre", async () => {
    mockValidateCountryForSignup.mockResolvedValue({ countryCode: "GH", currencyCode: "GHS" });
    mockAuthenticatedSession();
    const { insertedOrgs } = configureFrom();

    const result = await createOrganization({ name: "Accra Shop", countryCode: "gh" });

    expect(result.organizationId).toBe("org-1");
    expect(mockValidateCountryForSignup).toHaveBeenCalledWith("gh");
    expect(insertedOrgs[0]).toMatchObject({ p_country: "GH", p_currency: "GHS", p_name: "Accra Shop" });
  });

  it("régression Cameroun : un pays CM valide produit currency=XAF, country_code=CM, exactement comme avant le Country Engine", async () => {
    mockValidateCountryForSignup.mockResolvedValue({ countryCode: "CM", currencyCode: "XAF" });
    mockAuthenticatedSession();
    const { insertedOrgs } = configureFrom();

    await createOrganization({ name: "Boutique Yaoundé", countryCode: "CM" });

    expect(insertedOrgs[0]).toMatchObject({ p_country: "CM", p_currency: "XAF" });
  });
});

describe("createOrganization — limite, atomicité et sous-domaines réservés (Lot 4)", () => {
  beforeEach(() => {
    mockValidateCountryForSignup.mockResolvedValue({ countryCode: "CM", currencyCode: "XAF" });
    mockGetSupabaseServerSessionClient.mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }) },
    } as never);
    mockFrom.mockImplementation((table: string) =>
      table === "categories"
        ? { select: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }), insert: () => Promise.resolve({ error: null }) }
        : { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) },
    );
  });

  it("Q6 : déjà une entreprise gratuite -> message clair, rien d'autre n'est écrit", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "organization_limit_free", code: "P0001" } });
    await expect(createOrganization({ name: "Deuxième", countryCode: "CM" })).rejects.toThrow(/offre gratuite/);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("Q6 : 5 entreprises atteintes -> refus", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "organization_limit_total", code: "P0001" } });
    await expect(createOrganization({ name: "Sixième", countryCode: "CM" })).rejects.toThrow(/maximum/);
  });

  it("slug pris dans une course (23505) : retente avec un autre slug", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: "duplicate key", code: "23505" } })
      .mockResolvedValueOnce({ data: "org-7", error: null });
    const result = await createOrganization({ name: "Ma Boutique", countryCode: "CM" });
    expect(result.organizationId).toBe("org-7");
    expect(mockRpc.mock.calls[0]![1].p_slug).not.toBe(mockRpc.mock.calls[1]![1].p_slug);
  });

  it("Q29 : un nom qui donne un sous-domaine réservé reçoit un suffixe", async () => {
    mockRpc.mockResolvedValue({ data: "org-8", error: null });
    await createOrganization({ name: "Admin", countryCode: "CM" });
    const slug = mockRpc.mock.calls[0]![1].p_slug as string;
    expect(slug).not.toBe("admin");
    expect(slug.startsWith("admin-")).toBe(true);
  });

  it("erreur SQL inattendue -> propagée (rien de partiel : la transaction est annulée côté base)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    await expect(createOrganization({ name: "Ma Boutique", countryCode: "CM" })).rejects.toThrow(/Impossible de créer l'organisation: boom/);
  });
});
