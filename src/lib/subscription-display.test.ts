import { describe, it, expect } from "vitest";
import { subscriptionBadgeLabel, subscriptionDueLine } from "./subscription-display";

describe("subscriptionBadgeLabel", () => {
  it("l'offre gratuite active n'est PAS un « abonnement actif »", () => {
    expect(subscriptionBadgeLabel("free", "active")).toBe("Offre gratuite");
  });

  it("un plan payant actif est un abonnement actif", () => {
    expect(subscriptionBadgeLabel("starter", "active")).toBe("Abonnement actif");
    expect(subscriptionBadgeLabel("pro", "active")).toBe("Abonnement actif");
  });

  it("l'ancien essai reste identifiable comme état hérité", () => {
    expect(subscriptionBadgeLabel("starter", "trialing")).toBe("Essai (hérité)");
  });

  it("impayé, résilié, et statut inattendu affiché tel quel", () => {
    expect(subscriptionBadgeLabel("pro", "past_due")).toBe("Impayé");
    expect(subscriptionBadgeLabel("pro", "cancelled")).toBe("Résilié");
    expect(subscriptionBadgeLabel("pro", "inconnu")).toBe("inconnu");
  });
});

describe("subscriptionDueLine", () => {
  const base = { trialEnd: null, currentPeriodEnd: null };

  it("offre gratuite active : aucune échéance (jamais « Essai jusqu'au — »)", () => {
    expect(subscriptionDueLine({ ...base, planKey: "free", status: "active" })).toEqual({
      label: "Échéance",
      value: "Aucune (offre gratuite)",
    });
  });

  it("abonnement payant : date de fin de période, en français", () => {
    const line = subscriptionDueLine({ ...base, planKey: "starter", status: "active", currentPeriodEnd: "2026-10-15T12:00:00Z" });
    expect(line.label).toBe("Échéance");
    expect(line.value).toBe(new Date("2026-10-15T12:00:00Z").toLocaleDateString("fr-FR"));
  });

  it("abonnement payant sans date : tiret", () => {
    expect(subscriptionDueLine({ ...base, planKey: "pro", status: "past_due" }).value).toBe("—");
  });

  it("ancien essai : libellé explicite « hérité » avec la date de fin d'essai", () => {
    const line = subscriptionDueLine({ ...base, planKey: "starter", status: "trialing", trialEnd: "2026-09-30T12:00:00Z" });
    expect(line.label).toBe("Fin d'essai (hérité)");
    expect(line.value).toBe(new Date("2026-09-30T12:00:00Z").toLocaleDateString("fr-FR"));
  });
});
