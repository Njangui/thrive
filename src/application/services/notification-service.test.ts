import { describe, it, expect } from "vitest";
import { buildRelatedEntityUrl } from "./notification-service";

/**
 * Deux lots ont chacun ajouté une route ici (fusion #15 : union des deux) —
 * ce test garantit qu'aucune des deux ne disparaît lors d'une fusion future.
 */
describe("buildRelatedEntityUrl", () => {
  it("retourne null sans type ou sans id", () => {
    expect(buildRelatedEntityUrl(null, "x")).toBeNull();
    expect(buildRelatedEntityUrl("conversation", null)).toBeNull();
  });

  it("conversation → détail de la conversation", () => {
    expect(buildRelatedEntityUrl("conversation", "c1")).toBe("/dashboard/conversations/c1");
  });

  it("social_post et telegram_publication (Telegram Omnichannel v3) → liste Marketing", () => {
    expect(buildRelatedEntityUrl("social_post", "p1")).toBe("/dashboard/marketing");
    expect(buildRelatedEntityUrl("telegram_publication", "t1")).toBe("/dashboard/marketing");
  });

  it("phone_number (WhatsApp Coexistence, numéro dédié aux groupes) → Canaux", () => {
    expect(buildRelatedEntityUrl("phone_number", "n1")).toBe("/dashboard/channels");
  });

  it("subscription_payment reste dirigé vers Mon abonnement (pas vers Canaux)", () => {
    expect(buildRelatedEntityUrl("subscription_payment", "s1")).toBe("/dashboard/subscription");
  });

  it("type inconnu → null (notification non cliquable)", () => {
    expect(buildRelatedEntityUrl("inconnu", "z")).toBeNull();
  });
});
