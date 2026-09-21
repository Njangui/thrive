import { describe, it, expect } from "vitest";
import { deriveMessagingPolicy } from "./messaging-policy-service";

describe("deriveMessagingPolicy", () => {
  it("Discover : semi-automatique, jamais d'IA générative", () => {
    expect(deriveMessagingPolicy({ automatic: false, semiAutomatic: true })).toEqual({ mode: "semi_automatic", allowAI: false });
  });
  it("Starter/Pro : automatique avec IA en dernier recours", () => {
    expect(deriveMessagingPolicy({ automatic: true, semiAutomatic: true })).toEqual({ mode: "automatic", allowAI: true });
  });
  it("aucune des deux : off (fail-closed)", () => {
    expect(deriveMessagingPolicy({ automatic: false, semiAutomatic: false })).toEqual({ mode: "off", allowAI: false });
  });
});
