import { describe, expect, it } from "vitest";
import {
  canRequestPayout,
  computeCommissionAmountFcfa,
  computeHoldReleaseAt,
  exceedsClickVelocity,
  isConversionEligible,
  isHoldExpired,
  isSelfReferral,
  isValidReferralCode,
  summarizeBalance,
} from "./affiliate";

describe("computeCommissionAmountFcfa", () => {
  it("calcule 20% d'un montant rond", () => {
    expect(computeCommissionAmountFcfa(15000, 2000)).toBe(3000);
  });

  it("arrondit au FCFA le plus proche", () => {
    expect(computeCommissionAmountFcfa(10000, 2500)).toBe(2500);
    expect(computeCommissionAmountFcfa(999, 3333)).toBe(333); // 332.967 -> 333
  });

  it("un taux de 0 bps ne génère aucune commission", () => {
    expect(computeCommissionAmountFcfa(100000, 0)).toBe(0);
  });

  it("rejette un montant négatif", () => {
    expect(() => computeCommissionAmountFcfa(-1, 2000)).toThrow();
  });

  it("rejette un taux hors de [0, 10000]", () => {
    expect(() => computeCommissionAmountFcfa(1000, 10001)).toThrow();
    expect(() => computeCommissionAmountFcfa(1000, -1)).toThrow();
  });
});

describe("isConversionEligible", () => {
  it("recurringMonths=0 : seul le premier paiement est éligible", () => {
    expect(isConversionEligible(1, 0)).toBe(true);
    expect(isConversionEligible(2, 0)).toBe(false);
  });

  it("recurringMonths=3 : éligible jusqu'au 4e paiement inclus", () => {
    expect(isConversionEligible(1, 3)).toBe(true);
    expect(isConversionEligible(4, 3)).toBe(true);
    expect(isConversionEligible(5, 3)).toBe(false);
  });

  it("recurringMonths=-1 : toujours éligible, quel que soit le rang", () => {
    expect(isConversionEligible(1, -1)).toBe(true);
    expect(isConversionEligible(999, -1)).toBe(true);
  });

  it("rejette un sequenceNumber < 1", () => {
    expect(() => isConversionEligible(0, 0)).toThrow();
  });
});

describe("computeHoldReleaseAt / isHoldExpired", () => {
  it("ajoute le nombre de jours de rétention à la date de conversion", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const release = computeHoldReleaseAt(from, 14);
    expect(release.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("une rétention à 0 jour libère immédiatement", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(computeHoldReleaseAt(from, 0).getTime()).toBe(from.getTime());
  });

  it("isHoldExpired est vrai exactement à l'échéance et après", () => {
    const release = new Date("2026-01-15T00:00:00.000Z");
    expect(isHoldExpired(release, new Date("2026-01-14T23:59:59.999Z"))).toBe(false);
    expect(isHoldExpired(release, release)).toBe(true);
    expect(isHoldExpired(release, new Date("2026-01-16T00:00:00.000Z"))).toBe(true);
  });
});

describe("isValidReferralCode", () => {
  it("accepte un code alphanumérique de longueur valide", () => {
    expect(isValidReferralCode("abcd")).toBe(true);
    expect(isValidReferralCode("Insta_Bio-2026")).toBe(true);
  });

  it("rejette un code trop court, trop long, ou avec des caractères interdits", () => {
    expect(isValidReferralCode("abc")).toBe(false); // 3 chars < min 4
    expect(isValidReferralCode("a".repeat(33))).toBe(false); // > max 32
    expect(isValidReferralCode("code avec espace")).toBe(false);
    expect(isValidReferralCode("code/slash")).toBe(false);
    expect(isValidReferralCode("<script>")).toBe(false);
  });
});

describe("isSelfReferral", () => {
  it("détecte quand l'affilié et le propriétaire de la nouvelle organisation sont la même personne", () => {
    expect(isSelfReferral("user-1", "user-1")).toBe(true);
    expect(isSelfReferral("user-1", "user-2")).toBe(false);
  });
});

describe("exceedsClickVelocity", () => {
  it("ne flague pas un trafic normal", () => {
    expect(exceedsClickVelocity(5)).toBe(false);
  });

  it("flague au-delà du seuil configuré", () => {
    expect(exceedsClickVelocity(21)).toBe(true);
    expect(exceedsClickVelocity(20)).toBe(false);
  });
});

describe("summarizeBalance", () => {
  it("ventile les commissions par statut, en ignorant les commissions renversées", () => {
    const summary = summarizeBalance([
      { status: "pending_hold", commissionAmountFcfa: 1000 },
      { status: "pending_hold", commissionAmountFcfa: 500 },
      { status: "approved", commissionAmountFcfa: 2000 },
      { status: "paid", commissionAmountFcfa: 3000 },
      { status: "reversed", commissionAmountFcfa: 9999 },
    ]);

    expect(summary).toEqual({ pendingHoldFcfa: 1500, availableFcfa: 2000, paidFcfa: 3000 });
  });

  it("renvoie des totaux à zéro sans conversion", () => {
    expect(summarizeBalance([])).toEqual({ pendingHoldFcfa: 0, availableFcfa: 0, paidFcfa: 0 });
  });
});

describe("canRequestPayout", () => {
  it("autorise une demande au-dessus ou égale au minimum", () => {
    expect(canRequestPayout(10000, 10000)).toBe(true);
    expect(canRequestPayout(15000, 10000)).toBe(true);
  });

  it("refuse en dessous du minimum ou à zéro", () => {
    expect(canRequestPayout(9999, 10000)).toBe(false);
    expect(canRequestPayout(0, 10000)).toBe(false);
  });
});

import { normalizeEmailIdentity, normalizePhoneIdentity, selfReferralSignals } from "./affiliate";
describe("Q24 : auto-parrainage par second compte", () => {
  it("normalise e-mails (alias +, points Gmail) et téléphones", () => {
    expect(normalizeEmailIdentity("Jean.Dupont+promo@gmail.com")).toBe("jeandupont@gmail.com");
    expect(normalizeEmailIdentity("a@googlemail.com")).toBe("a@gmail.com");
    expect(normalizeEmailIdentity("a.b@societe.cm")).toBe("a.b@societe.cm");
    expect(normalizePhoneIdentity("+237 6 55 12 34 56")).toBe("55123456");
    expect(normalizePhoneIdentity("123")).toBeNull();
  });
  it("détecte les signaux et reste silencieux sinon", () => {
    expect(selfReferralSignals({ userId: "a", email: "x.y@gmail.com", phone: "655123456" }, { userId: "b", email: "xy+2@gmail.com", phone: "+237655123456" })).toEqual(["email", "phone"]);
    expect(selfReferralSignals({ userId: "a" }, { userId: "a" })).toEqual(["user_id"]);
    expect(selfReferralSignals({ userId: "a", email: "p@q.cm" }, { userId: "b", email: "z@q.cm" })).toEqual([]);
  });
});
