import { describe, expect, it } from "vitest";
import { trustZoneOf, type Channel } from "./contracts";

describe("contrats agents — zones de confiance", () => {
  it("le canal client est la seule zone vitrine", () => {
    const channels: Channel[] = ["dashboard", "telegram", "whatsapp", "scheduler", "customer"];
    const zones = Object.fromEntries(channels.map((c) => [c, trustZoneOf(c)]));
    expect(zones).toEqual({
      dashboard: "back_office",
      telegram: "back_office",
      whatsapp: "back_office",
      scheduler: "back_office",
      customer: "storefront",
    });
  });
});
