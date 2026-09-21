import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ hasFeature: vi.fn() }));
vi.mock("./entitlements-service", () => ({ hasFeature: mocks.hasFeature }));

import { assertGatedFeature, buildUpgradeMessage, isGatedFeatureEnabled } from "./feature-gate-service";
import { QuotaExceededError } from "@/lib/errors";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("feature-gate-service", () => {
  it("utilise la clé d'entitlement de la fonctionnalité (ex: diffusion contacts → broadcast_contacts)", async () => {
    mocks.hasFeature.mockResolvedValue(true);
    expect(await isGatedFeatureEnabled("org-1", "contact_broadcasts")).toBe(true);
    expect(mocks.hasFeature).toHaveBeenCalledWith("org-1", "broadcast_contacts");
  });

  it("assertGatedFeature lève QuotaExceededError avec le plan minimal quand la fonctionnalité n'est pas incluse", async () => {
    mocks.hasFeature.mockResolvedValue(false);
    await expect(assertGatedFeature("org-1", "orders")).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(assertGatedFeature("org-1", "orders")).rejects.toThrow(/Starter/);
  });

  it("le badge retirable est réservé à Pro", () => {
    expect(buildUpgradeMessage("remove_branding")).toMatch(/Pro/);
  });

  it("assertGatedFeature ne lève rien quand la fonctionnalité est incluse", async () => {
    mocks.hasFeature.mockResolvedValue(true);
    await expect(assertGatedFeature("org-1", "crm")).resolves.toBeUndefined();
  });
});
