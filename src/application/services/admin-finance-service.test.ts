import { describe, expect, it } from "vitest";
import { calculateZernioMonthlyCost } from "./admin-finance-service";

describe("calculateZernioMonthlyCost", () => {
  it("keeps the first two accounts free", () => {
    expect(calculateZernioMonthlyCost(0).netMonthlyUsd).toBe(0);
    expect(calculateZernioMonthlyCost(2).netMonthlyUsd).toBe(0);
  });

  it("uses graduated pricing instead of one flat rate", () => {
    expect(calculateZernioMonthlyCost(3).netMonthlyUsd).toBe(6);
    expect(calculateZernioMonthlyCost(10).netMonthlyUsd).toBe(48);
    expect(calculateZernioMonthlyCost(11).netMonthlyUsd).toBe(51);
    expect(calculateZernioMonthlyCost(20).netMonthlyUsd).toBe(78);
    expect(calculateZernioMonthlyCost(100).netMonthlyUsd).toBe(318);
    expect(calculateZernioMonthlyCost(101).netMonthlyUsd).toBe(319);
    expect(calculateZernioMonthlyCost(2000).netMonthlyUsd).toBe(2218);
    expect(calculateZernioMonthlyCost(2001).over2000Accounts).toBe(1);
    expect(calculateZernioMonthlyCost(2001).netMonthlyUsd).toBe(2219);
    expect(calculateZernioMonthlyCost(10000).netMonthlyUsd).toBe(10218);
  });

  it("does not charge the free credit twice", () => {
    const result = calculateZernioMonthlyCost(12);
    expect(result.tier6Accounts).toBe(8);
    expect(result.tier3Accounts).toBe(2);
    expect(result.billableAccounts).toBe(10);
    expect(result.netMonthlyUsd).toBe(54);
  });
});
