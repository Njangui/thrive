import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetCountries = vi.fn();
const mockGetCountry = vi.fn();
vi.mock("./notchpay-resources-service", () => ({
  getCountries: (...args: unknown[]) => mockGetCountries(...args),
  getCountry: (...args: unknown[]) => mockGetCountry(...args),
}));

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import {
  isCountryActive,
  isCountryComingSoon,
  isCountryOnWaitlist,
  isCountrySupportedByPaymentProvider,
  listPublicCountries,
  listSignupEligibleCountries,
  validateCountryForSignup,
  resolveCurrencyForCountry,
  joinCountryWaitlist,
  isoCodeToFlagEmoji,
  DEFAULT_CURRENCY_CODE,
} from "./country-service";
import { ValidationError } from "@/lib/errors";

function makeCountry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "id-1",
    isoCode: "CM",
    name: "Cameroun",
    nativeName: null,
    currencyCode: "XAF",
    currencyName: "Franc CFA",
    currencySymbol: "FCFA",
    phoneCode: "+237",
    flagUrl: null,
    notchpaySupported: true,
    launchStatus: "active",
    displayOrder: 0,
    metadata: {},
    lastSyncedAt: null,
    activatedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isCountryActive / isCountryComingSoon / isCountryOnWaitlist / isCountrySupportedByPaymentProvider", () => {
  it("reflète fidèlement launchStatus/notchpaySupported du pays", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ launchStatus: "active", notchpaySupported: true }));
    expect(await isCountryActive("CM")).toBe(true);
    expect(await isCountryComingSoon("CM")).toBe(false);
    expect(await isCountryOnWaitlist("CM")).toBe(false);
    expect(await isCountrySupportedByPaymentProvider("CM")).toBe(true);
  });

  it("un pays inconnu (getCountry renvoie null) : tout est false, jamais une exception", async () => {
    mockGetCountry.mockResolvedValue(null);
    expect(await isCountryActive("ZZ")).toBe(false);
    expect(await isCountryComingSoon("ZZ")).toBe(false);
    expect(await isCountryOnWaitlist("ZZ")).toBe(false);
    expect(await isCountrySupportedByPaymentProvider("ZZ")).toBe(false);
  });

  it("une erreur de lecture DB est absorbée : traité comme pays inconnu, ne lève jamais", async () => {
    mockGetCountry.mockRejectedValue(new Error("connexion perdue"));
    await expect(isCountryActive("CM")).resolves.toBe(false);
  });

  it("notchpay_supported=true n'implique JAMAIS active (section 6/7)", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ launchStatus: "disabled", notchpaySupported: true }));
    expect(await isCountrySupportedByPaymentProvider("NG")).toBe(true);
    expect(await isCountryActive("NG")).toBe(false);
  });
});

describe("listPublicCountries / listSignupEligibleCountries", () => {
  it("la landing publique inclut active + coming_soon + waitlist, jamais disabled", async () => {
    mockGetCountries.mockResolvedValue([
      makeCountry({ isoCode: "CM", launchStatus: "active" }),
      makeCountry({ isoCode: "CI", launchStatus: "coming_soon" }),
      makeCountry({ isoCode: "SN", launchStatus: "waitlist" }),
      makeCountry({ isoCode: "GH", launchStatus: "disabled" }),
    ]);

    const countries = await listPublicCountries();
    expect(countries.map((c) => c.isoCode)).toEqual(["CM", "CI", "SN"]);
  });

  it("ne renvoie que des champs publics (jamais metadata/notchpaySupported)", async () => {
    mockGetCountries.mockResolvedValue([makeCountry({ metadata: { secret: "interne" } })]);
    const countries = await listPublicCountries();
    expect(countries[0]).not.toHaveProperty("metadata");
    expect(countries[0]).not.toHaveProperty("notchpaySupported");
  });

  it("l'onboarding n'accepte QUE les pays active (jamais coming_soon/waitlist)", async () => {
    mockGetCountries.mockResolvedValue([
      makeCountry({ isoCode: "CM", launchStatus: "active" }),
      makeCountry({ isoCode: "CI", launchStatus: "coming_soon" }),
    ]);

    const countries = await listSignupEligibleCountries();
    expect(countries.map((c) => c.isoCode)).toEqual(["CM"]);
  });
});

describe("validateCountryForSignup", () => {
  it("un pays actif est accepté et renvoie sa devise", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "CM", currencyCode: "XAF", launchStatus: "active" }));
    await expect(validateCountryForSignup("cm")).resolves.toEqual({ countryCode: "CM", currencyCode: "XAF" });
  });

  it("un pays coming_soon est rejeté avec un message explicite", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ launchStatus: "coming_soon" }));
    await expect(validateCountryForSignup("CM")).rejects.toBeInstanceOf(ValidationError);
  });

  it("un pays disabled est rejeté", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ launchStatus: "disabled" }));
    await expect(validateCountryForSignup("CM")).rejects.toBeInstanceOf(ValidationError);
  });

  it("un pays waitlist est rejeté (inscription normale fermée)", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ launchStatus: "waitlist" }));
    await expect(validateCountryForSignup("CM")).rejects.toBeInstanceOf(ValidationError);
  });

  it("un pays inconnu est rejeté", async () => {
    mockGetCountry.mockResolvedValue(null);
    await expect(validateCountryForSignup("ZZ")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("resolveCurrencyForCountry", () => {
  it("renvoie la devise du pays", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ currencyCode: "NGN" }));
    expect(await resolveCurrencyForCountry("NG")).toBe("NGN");
  });

  it("ignore le launchStatus — un pays désactivé APRÈS coup garde sa devise pour les clients existants (section 21)", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ currencyCode: "GHS", launchStatus: "disabled" }));
    expect(await resolveCurrencyForCountry("GH")).toBe("GHS");
  });

  it("repli XAF si le pays est introuvable (défensif, jamais de crash sur le chemin de paiement)", async () => {
    mockGetCountry.mockResolvedValue(null);
    expect(await resolveCurrencyForCountry("ZZ")).toBe(DEFAULT_CURRENCY_CODE);
  });
});

describe("joinCountryWaitlist", () => {
  it("refuse un email invalide sans toucher la base", async () => {
    await expect(joinCountryWaitlist({ email: "pas-un-email", countryCode: "SN" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuse un pays inconnu", async () => {
    mockGetCountry.mockResolvedValue(null);
    await expect(joinCountryWaitlist({ email: "a@b.com", countryCode: "ZZ" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse un pays qui n'est ni waitlist ni coming_soon (ex: déjà active)", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ launchStatus: "active" }));
    await expect(joinCountryWaitlist({ email: "a@b.com", countryCode: "CM" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepte un pays waitlist et upsert la ligne (email normalisé en minuscule)", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "SN", launchStatus: "waitlist" }));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert });

    await joinCountryWaitlist({ email: "Test@Example.com", countryCode: "sn", companyName: "  Ma Boutique  " });

    expect(upsert).toHaveBeenCalledWith(
      { email: "test@example.com", country_code: "SN", company_name: "Ma Boutique" },
      expect.objectContaining({ onConflict: "email,country_code" }),
    );
  });

  it("accepte aussi un pays coming_soon", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "CI", launchStatus: "coming_soon" }));
    mockFrom.mockReturnValue({ upsert: vi.fn().mockResolvedValue({ error: null }) });
    await expect(joinCountryWaitlist({ email: "a@b.com", countryCode: "CI" })).resolves.not.toThrow();
  });
});

describe("isoCodeToFlagEmoji", () => {
  it("calcule l'emoji drapeau pour un code ISO valide", () => {
    expect(isoCodeToFlagEmoji("CM")).toBe("🇨🇲");
    expect(isoCodeToFlagEmoji("ng")).toBe("🇳🇬");
  });

  it("renvoie un drapeau blanc générique pour un code invalide", () => {
    expect(isoCodeToFlagEmoji("XX1")).toBe("🏳️");
  });
});
